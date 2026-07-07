#!/usr/bin/env python3
"""Package a Max patcher JSON (.maxpat) into a Max for Live .amxd device.

The .amxd container is a simple chunk format:
  "ampf" <u32le 4> <fourcc>          device type (aaaa/mmmm/iiii)
  "meta" <u32le 4> <4 zero bytes>
  "ptch" <u32le n> <patcher JSON + NUL>

Usage:
  build_amxd.py <input.maxpat> <output.amxd>
                [--type {audio,midi,instrument}]
                [--embed SCRIPT ...]
                [--allow-external NAME ...]

--embed injects each script's source into the matching [v8 <basename>] box
(the shape Max 9 itself writes for @embed 1: box-level "filename" plus a
"textfile" sibling), so the shipped .amxd is fully self-contained.
Embedding runs BEFORE validation; the output payload is the modified JSON.

Validation (all hard failures):
  - patch graph: every patchline source outlet < numoutlets, dest inlet < numinlets
  - no message-box text contains "---" ('---' substitutes only in object-box args)
  - every js/v8 newobj box is embedded (textfile.embed == 1) unless --allow-external
  - parameter_longname values unique across all boxes
  - every presentation==1 box's presentation_rect lies inside [0,0,460,169]
  - project.amxdtype (if present) matches --type
"""
import argparse
import json
import os
import struct
import sys

DEVICE_TYPES = {"audio": b"aaaa", "midi": b"mmmm", "instrument": b"iiii"}
PRESENTATION_BOUNDS = (0.0, 0.0, 460.0, 169.0)  # x, y, width, height


def iter_patchers(patcher: dict, where: str = "patcher"):
    """Yield (where, patcher_dict) for the top-level patcher and every subpatcher."""
    yield where, patcher
    for entry in patcher.get("boxes", []):
        box = entry["box"]
        sub = box.get("patcher")
        if isinstance(sub, dict):
            yield from iter_patchers(sub, f"{where}/{box.get('id', '?')}")


def embed_scripts(root: dict, script_paths: list) -> list:
    """Inject script sources into matching [v8 <basename>] boxes. Returns embedded basenames."""
    embedded = []
    for path in script_paths:
        basename = os.path.basename(path)
        with open(path, encoding="utf-8") as fh:
            source = fh.read()
        matched = 0
        did_embed = False
        for where, pat in iter_patchers(root["patcher"]):
            for entry in pat.get("boxes", []):
                box = entry["box"]
                if box.get("maxclass") != "newobj":
                    continue
                toks = str(box.get("text", "")).split()
                if len(toks) < 2 or toks[0] not in ("v8", "js") or toks[1] != basename:
                    continue
                matched += 1
                bid = f"{where}/{box.get('id', '?')}"
                if toks[0] == "js":
                    print(f"warning: {bid} [js {basename}] cannot embed scripts; "
                          f"convert the box to [v8 {basename} @embed 1]", file=sys.stderr)
                    continue
                box["filename"] = basename
                box["textfile"] = {
                    "text": source,
                    "filename": basename,
                    "flags": 1,
                    "embed": 1,
                    "autowatch": 0,
                }
                if "@embed" not in box["text"]:
                    box["text"] += " @embed 1"
                did_embed = True
        if matched == 0:
            raise SystemExit(f"error: --embed {path}: no [v8 {basename}] (or [js {basename}]) "
                             f"newobj box found in the patch")
        if did_embed:
            embedded.append(basename)
    dep = root["patcher"].get("dependency_cache")
    if isinstance(dep, list):
        root["patcher"]["dependency_cache"] = [
            d for d in dep if d.get("name") not in embedded
        ]
    return embedded


def validate(root: dict, allow_external: list) -> list:
    """Return a list of validation error strings (empty = patch is good)."""
    errors = []
    longnames = {}
    for where, pat in iter_patchers(root["patcher"]):
        boxes = {}
        for entry in pat.get("boxes", []):
            box = entry["box"]
            boxes[box["id"]] = box
            bid = f"{where}/{box['id']}"
            cls = box.get("maxclass")
            text = str(box.get("text", ""))

            # (a) '---' never substitutes inside message boxes -- silent failure at runtime
            if cls == "message" and "---" in text:
                errors.append(f"{bid}: message box contains '---' ({text!r}); '---' substitutes "
                              f"only in object-box arguments -- pass the name as an object argument "
                              f"(e.g. via jsarguments) instead")

            # (b) every js/v8 box must carry its source (textfile.embed == 1)
            if cls == "newobj":
                toks = text.split()
                if toks and toks[0] in ("js", "v8"):
                    script = toks[1] if len(toks) > 1 and not toks[1].startswith("@") else None
                    textfile = box.get("textfile") or {}
                    if textfile.get("embed") != 1 and script not in allow_external:
                        hint = (f"build with --embed <path/to/{script}>" if script
                                else "give the box a script filename and build with --embed")
                        errors.append(f"{bid}: [{text}] is not embedded (no textfile.embed==1); "
                                      f"{hint}, or list it via --allow-external")

            # (c) parameter_longname unique across the whole device
            longname = (box.get("saved_attribute_attributes") or {}) \
                .get("valueof", {}).get("parameter_longname")
            if longname is not None:
                if longname in longnames:
                    errors.append(f"{bid}: duplicate parameter_longname {longname!r} "
                                  f"(also on {longnames[longname]})")
                else:
                    longnames[longname] = bid

            # (d) presentation rects must fit the device view (top-level patcher only)
            if where == "patcher" and box.get("presentation") == 1:
                rect = box.get("presentation_rect")
                bx, by, bw, bh = PRESENTATION_BOUNDS
                if not rect or len(rect) != 4:
                    errors.append(f"{bid}: presentation==1 but no presentation_rect")
                elif not (rect[0] >= bx and rect[1] >= by
                          and rect[0] + rect[2] <= bx + bw and rect[1] + rect[3] <= by + bh):
                    errors.append(f"{bid}: presentation_rect {rect} exceeds device view "
                                  f"[{bx:g},{by:g},{bw:g},{bh:g}]")

        # (e) existing patch-graph check
        for line in pat.get("lines", []):
            pl = line["patchline"]
            src_id, src_out = pl["source"]
            dst_id, dst_in = pl["destination"]
            if src_id not in boxes:
                errors.append(f"{where}: line references unknown source {src_id}")
            else:
                n_out = boxes[src_id].get("numoutlets", 0)
                if src_out >= n_out:
                    errors.append(f"{where}: {src_id} outlet {src_out} >= numoutlets {n_out}")
            if dst_id not in boxes:
                errors.append(f"{where}: line references unknown destination {dst_id}")
            else:
                n_in = boxes[dst_id].get("numinlets", 1)
                if dst_in >= n_in:
                    errors.append(f"{where}: {dst_id} inlet {dst_in} >= numinlets {n_in}")
    return errors


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Package a .maxpat into a Max for Live .amxd, embedding v8 scripts "
                    "and validating the patch.")
    ap.add_argument("input", help="input .maxpat (patcher JSON)")
    ap.add_argument("output", help="output .amxd")
    ap.add_argument("--type", choices=sorted(DEVICE_TYPES), default="audio",
                    help="device type: audio (aaaa), midi (mmmm), instrument (iiii); "
                         "default audio")
    ap.add_argument("--embed", metavar="SCRIPT", action="extend", nargs="+", default=[],
                    help="script file(s) to embed into matching [v8 <basename>] boxes")
    ap.add_argument("--allow-external", metavar="NAME", action="extend", nargs="+",
                    default=[], dest="allow_external",
                    help="script basename(s) allowed to remain un-embedded")
    args = ap.parse_args()

    fourcc = DEVICE_TYPES[args.type]
    with open(args.input, encoding="utf-8") as fh:
        patcher = json.load(fh)

    # --type must agree with the patcher's own project.amxdtype (if it declares one)
    amxdtype = patcher["patcher"].get("project", {}).get("amxdtype")
    expected = int.from_bytes(fourcc, "little")
    if amxdtype is not None and amxdtype != expected:
        by_code = {int.from_bytes(f, "little"): n for n, f in DEVICE_TYPES.items()}
        actual_name = by_code.get(amxdtype, "unknown")
        raise SystemExit(
            f"error: --type {args.type} ('{fourcc.decode()}' = {expected}) does not match "
            f"the patcher's project.amxdtype {amxdtype} ({actual_name}); "
            f"fix --type or the patcher")

    # Embed BEFORE validation, so the embed check sees the final state
    embedded = embed_scripts(patcher, args.embed)

    errors = validate(patcher, args.allow_external)
    if errors:
        print(f"BUILD FAILED: {len(errors)} validation error(s) in {args.input}:",
              file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)

    payload = json.dumps(patcher, ensure_ascii=False).encode("utf-8")
    payload = payload.rstrip(b"\n") + b"\n\x00"
    out = (
        b"ampf" + struct.pack("<I", 4) + fourcc
        + b"meta" + struct.pack("<I", 4) + b"\x00" * 4
        + b"ptch" + struct.pack("<I", len(payload)) + payload
    )
    with open(args.output, "wb") as fh:
        fh.write(out)

    n_patchers = sum(1 for _ in iter_patchers(patcher["patcher"]))
    n_boxes = len(patcher["patcher"]["boxes"])
    n_lines = len(patcher["patcher"]["lines"])
    print(f"wrote {args.output} ({len(out)} bytes)")
    print(f"  type: {args.type} ('{fourcc.decode()}')")
    print(f"  embedded: {', '.join(embedded) if embedded else 'none'}")
    print(f"  patch graph OK: {n_boxes} boxes, {n_lines} lines"
          + (f" ({n_patchers} patchers)" if n_patchers > 1 else ""))


if __name__ == "__main__":
    main()
