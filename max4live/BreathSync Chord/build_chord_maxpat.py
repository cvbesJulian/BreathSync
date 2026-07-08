#!/usr/bin/env python3
"""Generate bs.chord.maxpat — the BreathSync Chord device patcher.

A .maxpat is plain JSON; this assembles the box/line graph programmatically so
it is reviewable and reproducible (Max can open and re-save it as usual).
Topology mirrors bs.follow.maxpat, with:
  * a v8 [bs.chord.js] with 3 outlets (MIDI / displays / predict-request),
  * a sibling [node.script nextchord.node.js] running the ONNX model,
  * bus in (receive -> route -> prepend -> v8), node reply (node -> v8),
  * MIDI out (v8 -> iter -> midiflush -> midiout ; midiin -> midiout).

Then run build_amxd.py to package + validate the .amxd.
"""
import json
import os

boxes = []
lines = []
_n = [0]


def nid():
    _n[0] += 1
    return "obj-%d" % _n[0]


def box(maxclass, rect, nin, nout, **extra):
    b = {"id": nid(), "maxclass": maxclass, "numinlets": nin, "numoutlets": nout,
         "patching_rect": [float(x) for x in rect]}
    if nout:
        b["outlettype"] = extra.pop("outlettype", [""] * nout)
    b.update(extra)
    boxes.append({"box": b})
    return b["id"]


def newobj(text, rect, nin, nout, **extra):
    return box("newobj", rect, nin, nout, text=text, **extra)


def message(text, rect, **extra):
    return box("message", rect, 2, 1, text=text, **extra)


def comment(text, rect, w=120):
    return box("comment", rect, 1, 0, text=text)


def line(src, so, dst, di):
    lines.append({"patchline": {"source": [src, so], "destination": [dst, di]}})


def param(maxclass, rect, prect, longname, shortname, ptype, extra_valueof=None, **extra):
    valueof = {"parameter_longname": longname, "parameter_shortname": shortname,
               "parameter_type": ptype, "parameter_modmode": 0}
    if extra_valueof:
        valueof.update(extra_valueof)
    nout = extra.pop("numoutlets", 2)
    return box(maxclass, rect, 1, nout, presentation=1, presentation_rect=[float(x) for x in prect],
               parameter_enable=1, outlettype=extra.pop("outlettype", [""] * nout),
               saved_attribute_attributes={"valueof": valueof}, **extra)


def dial(rect, prect, longname, shortname, mmin, mmax, init, ptype=0):
    return param("live.dial", rect, prect, longname, shortname, ptype,
                 {"parameter_mmin": mmin, "parameter_mmax": mmax,
                  "parameter_initial": [init], "parameter_initial_enable": 1,
                  "parameter_unitstyle": 0}, outlettype=["", "float"])


def toggle(rect, prect, longname, shortname, init=1):
    return param("live.toggle", rect, prect, longname, shortname, 2,
                 {"parameter_initial": [init], "parameter_initial_enable": 1,
                  "parameter_mmax": 1, "parameter_enum": ["off", "on"]})


def menu(rect, prect, longname, shortname, enum, init=0):
    return param("live.menu", rect, prect, longname, shortname, 2,
                 {"parameter_enum": enum, "parameter_initial": [init],
                  "parameter_initial_enable": 1, "parameter_mmax": len(enum) - 1},
                 numoutlets=3, outlettype=["", "", "float"])


def button(rect, prect, longname, shortname):
    return param("live.button", rect, prect, longname, shortname, 2, {}, outlettype=["bang"])


# --- lifecycle: thisdevice -> init, metro(watchdog), enabled -----------------
thisdev = newobj("live.thisdevice", [24, 24, 100, 22], 1, 3, outlettype=["bang", "", ""])
trig = newobj("t b b", [24, 56, 40, 22], 1, 2, outlettype=["bang", "bang"])
init_msg = message("init", [140, 56, 40, 22])
one_msg = message("1", [24, 92, 24, 22])
metro = newobj("metro 20", [24, 124, 70, 22], 2, 1, outlettype=["bang"])
wd_msg = message("watchdog", [24, 156, 70, 22])
en_msg = message("enabled $1", [200, 56, 80, 22])

# --- v8 + node.script --------------------------------------------------------
v8 = newobj("v8 bs.chord.js @autowatch 0", [24, 300, 200, 22], 1, 3,
            outlettype=["", "", ""], saved_object_attributes={"filename": "bs.chord.js", "parameter_enable": 0})
node = newobj("node.script nextchord.node.js @autostart 1", [300, 260, 260, 22], 1, 2,
              outlettype=["", "bang"], saved_object_attributes={"autostart": 1, "defer": 0})

# --- harmony bus in ----------------------------------------------------------
recv = newobj("receive bs.harmony.bus1", [24, 196, 160, 22], 1, 1)
route_bus = newobj("route state lead chord hello", [24, 228, 220, 22], 1, 5)
pre_state = newobj("prepend state", [24, 264, 90, 22], 1, 1)
pre_lead = newobj("prepend lead", [120, 264, 90, 22], 1, 1)

# --- MIDI out ----------------------------------------------------------------
it = newobj("iter", [24, 340, 40, 22], 1, 1)
mflush = newobj("midiflush", [24, 372, 70, 22], 1, 1)
mout = newobj("midiout", [24, 404, 70, 22], 1, 0)
min_ = newobj("midiin", [140, 372, 60, 22], 1, 1)

# --- displays ----------------------------------------------------------------
route_disp = newobj("route status chord key", [300, 300, 180, 22], 1, 4)
pre_s = newobj("prepend set", [300, 332, 80, 22], 1, 1)
pre_c = newobj("prepend set", [390, 332, 80, 22], 1, 1)
pre_k = newobj("prepend set", [480, 332, 80, 22], 1, 1)
disp_s = message("waiting for analyzer", [300, 364, 150, 22], presentation=1, presentation_rect=[10, 132, 200, 18])
disp_c = message("-", [300, 396, 150, 22], presentation=1, presentation_rect=[218, 132, 110, 18])
disp_k = message("-", [300, 428, 150, 22], presentation=1, presentation_rect=[336, 132, 114, 18])

# --- parameters (presentation) ----------------------------------------------
lab_row = 8
active_t = toggle([600, 24, 24, 24], [10, lab_row, 24, 24], "Active", "On", 1)
comp_d = dial([600, 60, 40, 36], [56, lab_row, 40, 36], "Complexity", "Cplx", 0.0, 1.0, 0.3)
free_d = dial([650, 60, 40, 36], [104, lab_row, 40, 36], "Freedom", "Free", 0.0, 1.0, 0.0)
wlen_d = dial([700, 60, 40, 36], [152, lab_row, 40, 36], "WindowBars", "Win", 1, 4, 2, ptype=1)
vel_d = dial([750, 60, 40, 36], [200, lab_row, 40, 36], "Velocity", "Vel", 1, 127, 90, ptype=1)
coct_d = dial([800, 60, 40, 36], [248, lab_row, 40, 36], "ChordOct", "Oct", -2, 2, 0, ptype=1)
wait_d = dial([850, 60, 40, 36], [296, lab_row, 40, 36], "WaitBars", "Wait", 0, 32, 2, ptype=1)
chan_m = menu([900, 60, 40, 22], [344, lab_row + 6, 46, 15], "Channel", "Ch",
              [str(i + 1) for i in range(16)], 0)
panic_b = button([600, 120, 24, 24], [406, lab_row, 24, 24], "Panic", "Panic")

# param message boxes -> v8
def pmsg(text, rect):
    return message(text, rect)


m_active = pmsg("active $1", [600, 96, 90, 22])
m_comp = pmsg("complexity $1", [640, 100, 100, 22])
m_free = pmsg("freedom $1", [740, 100, 90, 22])
m_wlen = pmsg("wlenbars $1", [840, 100, 90, 22])
m_vel = pmsg("vel $1", [600, 160, 70, 22])
m_coct = pmsg("chordoct $1", [680, 160, 90, 22])
m_wait = pmsg("waitbars $1", [780, 160, 90, 22])
m_chan = pmsg("channel $1", [880, 160, 90, 22])
m_panic = pmsg("panic", [600, 200, 50, 22])

# labels
comment("BreathSync Chord — ML next-chord comping", [10, 190, 320], 320)

# --- wiring ------------------------------------------------------------------
line(thisdev, 0, trig, 0)
line(trig, 1, init_msg, 0)          # rightmost-first: init before metro
line(init_msg, 0, v8, 0)
line(trig, 0, one_msg, 0)
line(one_msg, 0, metro, 0)
line(metro, 0, wd_msg, 0)
line(wd_msg, 0, v8, 0)
line(thisdev, 1, en_msg, 0)
line(en_msg, 0, v8, 0)

line(recv, 0, route_bus, 0)
line(route_bus, 0, pre_state, 0)
line(pre_state, 0, v8, 0)
line(route_bus, 1, pre_lead, 0)
line(pre_lead, 0, v8, 0)
# route_bus out2 (chord) / out3 (hello) intentionally unconnected (v8 ignores)

line(v8, 2, node, 0)                # predict <json> -> node.script
line(node, 0, v8, 0)                # modelchord / top -> v8 handlers

line(v8, 0, it, 0)                  # MIDI list -> iter -> midiflush -> midiout
line(it, 0, mflush, 0)
line(mflush, 0, mout, 0)
line(min_, 0, mout, 0)              # passthrough of the track's own MIDI

line(v8, 1, route_disp, 0)
line(route_disp, 0, pre_s, 0); line(pre_s, 0, disp_s, 0)
line(route_disp, 1, pre_c, 0); line(pre_c, 0, disp_c, 0)
line(route_disp, 2, pre_k, 0); line(pre_k, 0, disp_k, 0)

# params
line(active_t, 0, m_active, 0); line(m_active, 0, v8, 0)
line(comp_d, 0, m_comp, 0); line(m_comp, 0, v8, 0)
line(free_d, 0, m_free, 0); line(m_free, 0, v8, 0)
line(wlen_d, 0, m_wlen, 0); line(m_wlen, 0, v8, 0)
line(vel_d, 0, m_vel, 0); line(m_vel, 0, v8, 0)
line(coct_d, 0, m_coct, 0); line(m_coct, 0, v8, 0)
line(wait_d, 0, m_wait, 0); line(m_wait, 0, v8, 0)
line(chan_m, 0, m_chan, 0); line(m_chan, 0, v8, 0)
line(panic_b, 0, m_panic, 0); line(m_panic, 0, v8, 0); line(panic_b, 0, mflush, 0)

patcher = {
    "patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 0, "revision": 7, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [100.0, 100.0, 1100.0, 640.0],
        "openrect": [0.0, 0.0, 460.0, 169.0],
        "bglocked": 0,
        "openinpresentation": 1,
        "default_fontsize": 10.0,
        "default_fontface": 0,
        "default_fontname": "Arial",
        "gridonopen": 1,
        "gridsize": [15.0, 15.0],
        "boxes": boxes,
        "lines": lines,
        "originid": "pat-1",
        "dependency_cache": [],
        "autosave": 0,
    }
}

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bs.chord.maxpat")
with open(out, "w") as f:
    json.dump(patcher, f, indent=1)
print("wrote %s (%d boxes, %d lines)" % (out, len(boxes), len(lines)))
