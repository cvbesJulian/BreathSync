from nextchord import vocab


def test_load_and_ids():
    vocab.load()
    n = vocab.n_classes()
    assert n >= 10
    assert vocab.HOLD == 0
    assert vocab.other_id() == n - 1


def test_known_jazz_classes():
    vocab.load()
    # C major triad family
    assert vocab.class_of("C:maj") == vocab.class_of("C:maj7")  # collapsed to MAJ
    assert vocab.class_of("C:maj") != vocab.class_of("C:7")     # MAJ vs DOM distinct
    assert vocab.class_of("D:min7") == vocab.class_of("D:min")  # MIN family
    # G7 is dominant function
    g7 = vocab.class_of("G:7")
    assert vocab.function_of(g7, "maj") == vocab.D
    # Dm7 is predominant (ii)
    dm = vocab.class_of("D:min7")
    assert vocab.function_of(dm, "maj") == vocab.PD
    # Cmaj tonic
    assert vocab.function_of(vocab.class_of("C:maj"), "maj") == vocab.T


def test_absolute_label_inverts_transpose():
    vocab.load()
    # In a song with offset 5 (tonic G -> C), class C-MAJ should read as G.
    cmaj = vocab.class_of("C:maj")
    assert vocab.absolute_label(cmaj, 5, "maj") == "G"
    g7 = vocab.class_of("G:7")
    assert vocab.absolute_label(g7, 5, "maj") == "D7"


def test_roman_render():
    vocab.load()
    assert vocab.roman_of(vocab.class_of("C:maj"), "maj") == "I"
    assert vocab.roman_of(vocab.class_of("G:7"), "maj") == "V7"
    assert vocab.roman_of(vocab.class_of("D:min7"), "maj") == "ii"
