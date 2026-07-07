{
	"patcher": {
		"fileversion": 1,
		"appversion": {
			"major": 9,
			"minor": 0,
			"revision": 7,
			"architecture": "x64",
			"modernui": 1
		},
		"classnamespace": "box",
		"rect": [
			100.0,
			100.0,
			1200.0,
			760.0
		],
		"openrect": [
			0.0,
			0.0,
			460.0,
			169.0
		],
		"bglocked": 0,
		"openinpresentation": 1,
		"default_fontsize": 10.0,
		"default_fontface": 0,
		"default_fontname": "Arial Bold",
		"gridonopen": 1,
		"gridsize": [
			8.0,
			8.0
		],
		"gridsnaponopen": 1,
		"objectsnaponopen": 1,
		"statusbarvisible": 2,
		"toolbarvisible": 1,
		"lefttoolbarpinned": 0,
		"toptoolbarpinned": 0,
		"righttoolbarpinned": 0,
		"bottomtoolbarpinned": 0,
		"toolbars_unpinned_last_save": 0,
		"tallnewobj": 0,
		"boxanimatetime": 500,
		"enablehscroll": 1,
		"enablevscroll": 1,
		"devicewidth": 460.0,
		"description": "MIDI companion for BreathSync Listen: harmony-bus consumer, Lead/Chord note generation and Live 12 scale sync.",
		"digest": "",
		"tags": "",
		"style": "",
		"subpatcher_template": "",
		"boxes": [
			{
				"box": {
					"id": "obj-21",
					"maxclass": "live.tab",
					"numinlets": 1,
					"numoutlets": 3,
					"outlettype": [
						"",
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						460.0,
						32.0,
						168.0,
						18.0
					],
					"presentation": 1,
					"presentation_rect": [
						4.0,
						38.0,
						168.0,
						18.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_enum": [
								"Off",
								"Lead",
								"Chord",
								"Both"
							],
							"parameter_initial": [
								1
							],
							"parameter_initial_enable": 1,
							"parameter_longname": "Mode",
							"parameter_mmax": 3,
							"parameter_modmode": 0,
							"parameter_shortname": "Mode",
							"parameter_type": 2,
							"parameter_unitstyle": 9
						}
					},
					"varname": "mode_tab"
				}
			},
			{
				"box": {
					"id": "obj-23",
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						560.0,
						32.0,
						40.0,
						36.0
					],
					"presentation": 1,
					"presentation_rect": [
						180.0,
						30.0,
						40.0,
						36.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_initial": [
								96
							],
							"parameter_initial_enable": 1,
							"parameter_longname": "Velocity",
							"parameter_mmin": 1,
							"parameter_mmax": 127,
							"parameter_modmode": 0,
							"parameter_shortname": "Vel",
							"parameter_type": 1,
							"parameter_unitstyle": 0
						}
					},
					"varname": "vel_dial"
				}
			},
			{
				"box": {
					"id": "obj-25",
					"maxclass": "live.toggle",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"parameter_enable": 1,
					"patching_rect": [
						660.0,
						32.0,
						16.0,
						16.0
					],
					"presentation": 1,
					"presentation_rect": [
						224.0,
						40.0,
						16.0,
						16.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_enum": [
								"off",
								"on"
							],
							"parameter_initial": [
								0
							],
							"parameter_initial_enable": 1,
							"parameter_longname": "Vel x Conf",
							"parameter_mmax": 1,
							"parameter_modmode": 0,
							"parameter_shortname": "xConf",
							"parameter_type": 2
						}
					},
					"varname": "velconf_toggle"
				}
			},
			{
				"box": {
					"id": "obj-27",
					"maxclass": "live.menu",
					"numinlets": 1,
					"numoutlets": 3,
					"outlettype": [
						"",
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						740.0,
						32.0,
						40.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						264.0,
						32.0,
						40.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_enum": [
								"1",
								"2",
								"3",
								"4",
								"5",
								"6",
								"7",
								"8",
								"9",
								"10",
								"11",
								"12",
								"13",
								"14",
								"15",
								"16"
							],
							"parameter_initial": [
								0
							],
							"parameter_initial_enable": 1,
							"parameter_longname": "Channel",
							"parameter_mmax": 15,
							"parameter_modmode": 0,
							"parameter_shortname": "CH",
							"parameter_type": 2
						}
					},
					"varname": "channel_menu"
				}
			},
			{
				"box": {
					"id": "obj-29",
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						840.0,
						32.0,
						40.0,
						36.0
					],
					"presentation": 1,
					"presentation_rect": [
						312.0,
						30.0,
						40.0,
						36.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_initial": [
								0
							],
							"parameter_initial_enable": 1,
							"parameter_longname": "Lead Oct",
							"parameter_mmin": -2,
							"parameter_mmax": 2,
							"parameter_modmode": 0,
							"parameter_shortname": "Ld Oct",
							"parameter_type": 1,
							"parameter_unitstyle": 0
						}
					},
					"varname": "leadoct_dial"
				}
			},
			{
				"box": {
					"id": "obj-31",
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						940.0,
						32.0,
						40.0,
						36.0
					],
					"presentation": 1,
					"presentation_rect": [
						356.0,
						30.0,
						40.0,
						36.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_initial": [
								0
							],
							"parameter_initial_enable": 1,
							"parameter_longname": "Chord Oct",
							"parameter_mmin": -2,
							"parameter_mmax": 2,
							"parameter_modmode": 0,
							"parameter_shortname": "Ch Oct",
							"parameter_type": 1,
							"parameter_unitstyle": 0
						}
					},
					"varname": "chordoct_dial"
				}
			},
			{
				"box": {
					"id": "obj-33",
					"maxclass": "live.toggle",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"parameter_enable": 1,
					"patching_rect": [
						460.0,
						152.0,
						16.0,
						16.0
					],
					"presentation": 1,
					"presentation_rect": [
						4.0,
						126.0,
						16.0,
						16.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_enum": [
								"off",
								"on"
							],
							"parameter_initial": [
								0
							],
							"parameter_initial_enable": 1,
							"parameter_longname": "Key Sync",
							"parameter_mmax": 1,
							"parameter_modmode": 0,
							"parameter_shortname": "Sync",
							"parameter_type": 2
						}
					},
					"varname": "keysync_toggle"
				}
			},
			{
				"box": {
					"id": "obj-35",
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						560.0,
						152.0,
						40.0,
						36.0
					],
					"presentation": 1,
					"presentation_rect": [
						48.0,
						124.0,
						40.0,
						36.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_initial": [
								0.5
							],
							"parameter_initial_enable": 1,
							"parameter_longname": "Key Conf",
							"parameter_mmin": 0.2,
							"parameter_mmax": 0.9,
							"parameter_modmode": 0,
							"parameter_shortname": "K Conf",
							"parameter_type": 0,
							"parameter_unitstyle": 1
						}
					},
					"varname": "keyconf_dial"
				}
			},
			{
				"box": {
					"id": "obj-37",
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						1040.0,
						32.0,
						40.0,
						36.0
					],
					"presentation": 1,
					"presentation_rect": [
						400.0,
						30.0,
						40.0,
						36.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_initial": [
								100
							],
							"parameter_initial_enable": 1,
							"parameter_longname": "Min Dur",
							"parameter_mmin": 0,
							"parameter_mmax": 500,
							"parameter_modmode": 0,
							"parameter_shortname": "MinDur",
							"parameter_type": 1,
							"parameter_unitstyle": 2
						}
					},
					"varname": "mindur_dial"
				}
			},
			{
				"box": {
					"id": "obj-39",
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						660.0,
						152.0,
						40.0,
						36.0
					],
					"presentation": 1,
					"presentation_rect": [
						92.0,
						124.0,
						40.0,
						36.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_initial": [
								5
							],
							"parameter_initial_enable": 1,
							"parameter_longname": "Key Hold",
							"parameter_mmin": 1,
							"parameter_mmax": 30,
							"parameter_modmode": 0,
							"parameter_shortname": "K Hold",
							"parameter_type": 1,
							"parameter_unitstyle": 0
						}
					},
					"varname": "keyhold_dial"
				}
			},
			{
				"box": {
					"id": "obj-8",
					"maxclass": "live.menu",
					"numinlets": 1,
					"numoutlets": 3,
					"outlettype": [
						"",
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						24.0,
						240.0,
						40.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						296.0,
						3.0,
						36.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_enum": [
								"1",
								"2",
								"3",
								"4",
								"5",
								"6",
								"7",
								"8"
							],
							"parameter_initial": [
								0
							],
							"parameter_initial_enable": 1,
							"parameter_invisible": 2,
							"parameter_longname": "Bus",
							"parameter_mmax": 7,
							"parameter_modmode": 0,
							"parameter_shortname": "Bus",
							"parameter_type": 2
						}
					},
					"varname": "bus_menu"
				}
			},
			{
				"box": {
					"id": "obj-41",
					"maxclass": "live.button",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"parameter_enable": 1,
					"patching_rect": [
						760.0,
						152.0,
						20.0,
						20.0
					],
					"presentation": 1,
					"presentation_rect": [
						428.0,
						82.0,
						20.0,
						20.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_enum": [
								"off",
								"on"
							],
							"parameter_invisible": 1,
							"parameter_longname": "Panic",
							"parameter_mmax": 1,
							"parameter_modmode": 0,
							"parameter_shortname": "Panic",
							"parameter_type": 2
						}
					},
					"varname": "panic_button"
				}
			},
			{
				"box": {
					"id": "obj-1",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 3,
					"patching_rect": [
						24.0,
						32.0,
						76.0,
						20.0
					],
					"text": "live.thisdevice",
					"outlettype": [
						"bang",
						"int",
						"int"
					]
				}
			},
			{
				"box": {
					"id": "obj-2",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 3,
					"patching_rect": [
						24.0,
						72.0,
						50.0,
						20.0
					],
					"text": "t b b b",
					"outlettype": [
						"bang",
						"bang",
						"bang"
					]
				}
			},
			{
				"box": {
					"id": "obj-3",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						148.0,
						112.0,
						32.0,
						20.0
					],
					"text": "init"
				}
			},
			{
				"box": {
					"id": "obj-4",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						24.0,
						112.0,
						24.0,
						20.0
					],
					"text": "1"
				}
			},
			{
				"box": {
					"id": "obj-5",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"patching_rect": [
						24.0,
						144.0,
						64.0,
						20.0
					],
					"text": "metro 250",
					"outlettype": [
						"bang"
					]
				}
			},
			{
				"box": {
					"id": "obj-6",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						24.0,
						176.0,
						62.0,
						20.0
					],
					"text": "watchdog"
				}
			},
			{
				"box": {
					"id": "obj-7",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						200.0,
						72.0,
						68.0,
						20.0
					],
					"text": "enabled $1"
				}
			},
			{
				"box": {
					"id": "obj-9",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"patching_rect": [
						24.0,
						272.0,
						32.0,
						20.0
					],
					"text": "+ 1",
					"outlettype": [
						"int"
					]
				}
			},
			{
				"box": {
					"id": "obj-10",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						24.0,
						304.0,
						172.0,
						20.0
					],
					"text": "sprintf set bs.harmony.bus%ld",
					"outlettype": [
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-11",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						24.0,
						336.0,
						52.0,
						20.0
					],
					"text": "receive",
					"outlettype": [
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-12",
					"maxclass": "newobj",
					"numinlets": 5,
					"numoutlets": 5,
					"patching_rect": [
						24.0,
						368.0,
						160.0,
						20.0
					],
					"text": "route state lead chord hello",
					"outlettype": [
						"",
						"",
						"",
						"",
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-13",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						24.0,
						400.0,
						84.0,
						20.0
					],
					"text": "prepend state",
					"outlettype": [
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-14",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						120.0,
						400.0,
						80.0,
						20.0
					],
					"text": "prepend lead",
					"outlettype": [
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-15",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						212.0,
						400.0,
						86.0,
						20.0
					],
					"text": "prepend chord",
					"outlettype": [
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-16",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						310.0,
						400.0,
						82.0,
						20.0
					],
					"text": "prepend hello",
					"outlettype": [
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-17",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 2,
					"patching_rect": [
						24.0,
						464.0,
						170.0,
						20.0
					],
					"text": "v8 bs.follow.js @autowatch 0",
					"outlettype": [
						"",
						""
					],
					"saved_object_attributes": {
						"filename": "bs.follow.js",
						"parameter_enable": 0
					}
				}
			},
			{
				"box": {
					"id": "obj-18",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						320.0,
						464.0,
						44.0,
						20.0
					],
					"text": "midiin",
					"outlettype": [
						"int"
					]
				}
			},
			{
				"box": {
					"id": "obj-19",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						24.0,
						504.0,
						60.0,
						20.0
					],
					"text": "midiflush",
					"outlettype": [
						"int"
					]
				}
			},
			{
				"box": {
					"id": "obj-20",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						24.0,
						544.0,
						48.0,
						20.0
					],
					"text": "midiout"
				}
			},
			{
				"box": {
					"id": "obj-22",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						460.0,
						72.0,
						54.0,
						20.0
					],
					"text": "mode $1"
				}
			},
			{
				"box": {
					"id": "obj-24",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						560.0,
						72.0,
						44.0,
						20.0
					],
					"text": "vel $1"
				}
			},
			{
				"box": {
					"id": "obj-26",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						660.0,
						72.0,
						68.0,
						20.0
					],
					"text": "velconf $1"
				}
			},
			{
				"box": {
					"id": "obj-28",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						740.0,
						72.0,
						68.0,
						20.0
					],
					"text": "channel $1"
				}
			},
			{
				"box": {
					"id": "obj-30",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						840.0,
						72.0,
						66.0,
						20.0
					],
					"text": "leadoct $1"
				}
			},
			{
				"box": {
					"id": "obj-32",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						940.0,
						72.0,
						74.0,
						20.0
					],
					"text": "chordoct $1"
				}
			},
			{
				"box": {
					"id": "obj-34",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						460.0,
						192.0,
						70.0,
						20.0
					],
					"text": "keysync $1"
				}
			},
			{
				"box": {
					"id": "obj-36",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						560.0,
						192.0,
						68.0,
						20.0
					],
					"text": "keyconf $1"
				}
			},
			{
				"box": {
					"id": "obj-38",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						1040.0,
						72.0,
						64.0,
						20.0
					],
					"text": "mindur $1"
				}
			},
			{
				"box": {
					"id": "obj-40",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						660.0,
						192.0,
						68.0,
						20.0
					],
					"text": "keyhold $1"
				}
			},
			{
				"box": {
					"id": "obj-42",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						760.0,
						192.0,
						42.0,
						20.0
					],
					"text": "panic"
				}
			},
			{
				"box": {
					"id": "obj-43",
					"maxclass": "newobj",
					"numinlets": 5,
					"numoutlets": 5,
					"patching_rect": [
						240.0,
						504.0,
						196.0,
						20.0
					],
					"text": "route status inchord inkey lastset",
					"outlettype": [
						"",
						"",
						"",
						"",
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-44",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						240.0,
						544.0,
						71.0,
						20.0
					],
					"text": "prepend set",
					"outlettype": [
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-45",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						240.0,
						584.0,
						120.0,
						20.0
					],
					"text": "waiting for analyzer",
					"presentation": 1,
					"presentation_rect": [
						336.0,
						3.0,
						120.0,
						17.0
					],
					"fontsize": 8.0
				}
			},
			{
				"box": {
					"id": "obj-46",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						328.0,
						544.0,
						71.0,
						20.0
					],
					"text": "prepend set",
					"outlettype": [
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-47",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						328.0,
						584.0,
						80.0,
						20.0
					],
					"text": "-",
					"presentation": 1,
					"presentation_rect": [
						4.0,
						84.0,
						150.0,
						17.0
					],
					"fontsize": 9.0
				}
			},
			{
				"box": {
					"id": "obj-48",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						416.0,
						544.0,
						71.0,
						20.0
					],
					"text": "prepend set",
					"outlettype": [
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-49",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						416.0,
						584.0,
						80.0,
						20.0
					],
					"text": "-",
					"presentation": 1,
					"presentation_rect": [
						160.0,
						84.0,
						150.0,
						17.0
					],
					"fontsize": 9.0
				}
			},
			{
				"box": {
					"id": "obj-50",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"patching_rect": [
						504.0,
						544.0,
						71.0,
						20.0
					],
					"text": "prepend set",
					"outlettype": [
						""
					]
				}
			},
			{
				"box": {
					"id": "obj-51",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						504.0,
						584.0,
						80.0,
						20.0
					],
					"text": "-",
					"presentation": 1,
					"presentation_rect": [
						140.0,
						126.0,
						240.0,
						17.0
					],
					"fontsize": 9.0
				}
			},
			{
				"box": {
					"id": "obj-52",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						24.0,
						624.0,
						120.0,
						18.0
					],
					"presentation": 1,
					"presentation_rect": [
						4.0,
						2.0,
						110.0,
						18.0
					],
					"fontsize": 10.0,
					"text": "BreathSync Follow"
				}
			},
			{
				"box": {
					"id": "obj-53",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						152.0,
						624.0,
						30.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						268.0,
						5.0,
						26.0,
						12.0
					],
					"fontsize": 8.0,
					"text": "BUS"
				}
			},
			{
				"box": {
					"id": "obj-54",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						192.0,
						624.0,
						60.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						4.0,
						22.0,
						60.0,
						14.0
					],
					"fontsize": 9.0,
					"text": "MIDI OUT"
				}
			},
			{
				"box": {
					"id": "obj-55",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						264.0,
						624.0,
						44.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						220.0,
						26.0,
						40.0,
						12.0
					],
					"fontsize": 8.0,
					"text": "x CONF"
				}
			},
			{
				"box": {
					"id": "obj-56",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						320.0,
						624.0,
						30.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						264.0,
						20.0,
						30.0,
						12.0
					],
					"fontsize": 8.0,
					"text": "CH"
				}
			},
			{
				"box": {
					"id": "obj-57",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						360.0,
						624.0,
						60.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						4.0,
						70.0,
						60.0,
						12.0
					],
					"fontsize": 8.0,
					"text": "CHORD IN"
				}
			},
			{
				"box": {
					"id": "obj-58",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						428.0,
						624.0,
						60.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						160.0,
						70.0,
						60.0,
						12.0
					],
					"fontsize": 8.0,
					"text": "KEY IN"
				}
			},
			{
				"box": {
					"id": "obj-59",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						496.0,
						624.0,
						44.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						416.0,
						104.0,
						44.0,
						12.0
					],
					"fontsize": 8.0,
					"text": "PANIC"
				}
			},
			{
				"box": {
					"id": "obj-60",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						552.0,
						624.0,
						140.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						4.0,
						110.0,
						160.0,
						14.0
					],
					"fontsize": 9.0,
					"text": "KEY SYNC → LIVE SCALE"
				}
			}
		],
		"lines": [
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-1",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-3",
						0
					],
					"source": [
						"obj-2",
						2
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-3",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-8",
						0
					],
					"source": [
						"obj-2",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-4",
						0
					],
					"source": [
						"obj-2",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-5",
						0
					],
					"source": [
						"obj-4",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-6",
						0
					],
					"source": [
						"obj-5",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-6",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-7",
						0
					],
					"source": [
						"obj-1",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-7",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-9",
						0
					],
					"source": [
						"obj-8",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-10",
						0
					],
					"source": [
						"obj-9",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-11",
						0
					],
					"source": [
						"obj-10",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-12",
						0
					],
					"source": [
						"obj-11",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-13",
						0
					],
					"source": [
						"obj-12",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-13",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-14",
						0
					],
					"source": [
						"obj-12",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-14",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-15",
						0
					],
					"source": [
						"obj-12",
						2
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-15",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-16",
						0
					],
					"source": [
						"obj-12",
						3
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-16",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-19",
						0
					],
					"source": [
						"obj-17",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-20",
						0
					],
					"source": [
						"obj-19",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-20",
						0
					],
					"source": [
						"obj-18",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-22",
						0
					],
					"source": [
						"obj-21",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-22",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-24",
						0
					],
					"source": [
						"obj-23",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-24",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-26",
						0
					],
					"source": [
						"obj-25",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-26",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-28",
						0
					],
					"source": [
						"obj-27",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-28",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-30",
						0
					],
					"source": [
						"obj-29",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-30",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-32",
						0
					],
					"source": [
						"obj-31",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-32",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-34",
						0
					],
					"source": [
						"obj-33",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-34",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-36",
						0
					],
					"source": [
						"obj-35",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-36",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-38",
						0
					],
					"source": [
						"obj-37",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-38",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-40",
						0
					],
					"source": [
						"obj-39",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-40",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-42",
						0
					],
					"source": [
						"obj-41",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-42",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-19",
						0
					],
					"source": [
						"obj-41",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-43",
						0
					],
					"source": [
						"obj-17",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-44",
						0
					],
					"source": [
						"obj-43",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-45",
						0
					],
					"source": [
						"obj-44",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-46",
						0
					],
					"source": [
						"obj-43",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-47",
						0
					],
					"source": [
						"obj-46",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-48",
						0
					],
					"source": [
						"obj-43",
						2
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-49",
						0
					],
					"source": [
						"obj-48",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-50",
						0
					],
					"source": [
						"obj-43",
						3
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-51",
						0
					],
					"source": [
						"obj-50",
						0
					]
				}
			}
		],
		"dependency_cache": [
			{
				"name": "bs.follow.js",
				"bootpath": ".",
				"patcherrelativepath": ".",
				"type": "TEXT",
				"implicit": 1
			}
		],
		"latency": 0,
		"project": {
			"version": 1,
			"creationdate": 3590052493,
			"modificationdate": 3590052493,
			"viewrect": [
				0.0,
				0.0,
				300.0,
				500.0
			],
			"autoorganize": 1,
			"hideprojectwindow": 1,
			"showdependencies": 1,
			"autolocalize": 0,
			"contents": {
				"patchers": {}
			},
			"layout": {},
			"searchpath": {},
			"detailsvisible": 0,
			"amxdtype": 1835887981,
			"readonly": 0,
			"devpathtype": 0,
			"devpath": ".",
			"sortmode": 0,
			"viewmode": 0
		},
		"autosave": 0
	}
}
