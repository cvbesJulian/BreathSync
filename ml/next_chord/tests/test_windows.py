from nextchord import pipeline, windows, features, dataset as ds, vocab


def test_seqlen_within_cap():
    cfg, songs, spec, splits = pipeline.load_everything()
    over = 0
    for sid in splits["train"]:
        s = songs[sid]
        for dp in s.decisions:
            n = len(windows.notes_in_window(s, dp.t, 4.0 * s.beats_per_bar))
            if n > spec.max_notes:
                over += 1
    # truncation handles rare overflows; ensure the cap is basically adequate
    assert over < 50


def test_collate_shapes():
    cfg, songs, spec, splits = pipeline.load_everything()
    dset = ds.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    batch = ds.collate([dset[i] for i in range(8)], spec)
    assert batch["global_ids"].shape == (8, features.N_GLOBALS)
    for k in features.NOTE_FEATS:
        assert batch["note_feats"][k].shape == (8, spec.max_notes)
    assert batch["note_mask"].shape == (8, spec.max_notes)
    assert batch["target"].max().item() < vocab.n_classes()


def test_masked_ablation_is_truly_note_blind():
    # mask_notes must yield zero encoded notes so note_mask is all-False
    # (otherwise the melody-masked ablation leaks the note count).
    cfg, songs, spec, splits = pipeline.load_everything()
    s = songs[splits["val"][0]]
    dp = next(d for d in s.decisions if not d.is_hold_candidate)
    ex = windows.build_example(s, dp, spec, 2.0, mask_notes=True)
    assert ex["n_notes"] == 0
    batch = ds.collate([ex], spec)
    assert batch["note_mask"].sum().item() == 0


def test_hold_and_change_targets_present():
    cfg, songs, spec, splits = pipeline.load_everything()
    holds = changes = 0
    for sid in splits["val"]:
        for dp in songs[sid].decisions:
            if dp.target == vocab.HOLD:
                holds += 1
            else:
                changes += 1
    assert holds > 0 and changes > 0
