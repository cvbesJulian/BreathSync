"""Models: NextChordTransformer (main) and BiGRUBaseline.

Both consume the collated batch:
  global_ids [B, G] (int), note_feats {feat: [B, M] int}, note_mask [B, M] bool
and predict a chord-class distribution (+ auxiliary T/PD/D function head).
"""

import torch
import torch.nn as nn

from . import features


class Embedder(nn.Module):
    """Maps ids -> (global_tokens [B,G,d], note_tokens [B,M,d])."""

    def __init__(self, spec, d_model):
        super().__init__()
        self.d_model = d_model
        self.global_emb = nn.ModuleList([
            nn.Embedding(spec.global_card[slot], d_model)
            for slot in features.GLOBAL_SLOTS
        ])
        self.note_emb = nn.ModuleDict({
            feat: nn.Embedding(spec.note_card[feat], d_model, padding_idx=0)
            for feat in features.NOTE_FEATS
        })
        self.note_type = nn.Parameter(torch.zeros(d_model))

    def forward(self, global_ids, note_feats):
        B = global_ids.shape[0]
        gtok = torch.stack([
            emb(global_ids[:, i]) for i, emb in enumerate(self.global_emb)
        ], dim=1)  # [B, G, d]
        ntok = None
        for feat in features.NOTE_FEATS:
            e = self.note_emb[feat](note_feats[feat])
            ntok = e if ntok is None else ntok + e
        ntok = ntok + self.note_type  # [B, M, d]
        return gtok, ntok


class NextChordTransformer(nn.Module):
    def __init__(self, spec, n_classes, cfg):
        super().__init__()
        m = cfg["model"]
        d = m["d_model"]
        self.embed = Embedder(spec, d)
        layer = nn.TransformerEncoderLayer(
            d_model=d, nhead=m["n_heads"], dim_feedforward=m["ff_dim"],
            dropout=m["dropout"], batch_first=True, activation="gelu",
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=m["n_layers"])
        self.norm = nn.LayerNorm(d)
        self.chord_head = nn.Linear(d, n_classes)
        self.func_head = nn.Linear(d, 3)

    def forward(self, global_ids, note_feats, note_mask):
        gtok, ntok = self.embed(global_ids, note_feats)
        seq = torch.cat([gtok, ntok], dim=1)               # [B, G+M, d]
        B, G = gtok.shape[0], gtok.shape[1]
        gpad = torch.zeros(B, G, dtype=torch.bool, device=seq.device)
        key_padding = torch.cat([gpad, ~note_mask], dim=1)  # True = ignore
        h = self.encoder(seq, src_key_padding_mask=key_padding)
        cls = self.norm(h[:, 0])                            # CLS token
        return self.chord_head(cls), self.func_head(cls)


class BiGRUBaseline(nn.Module):
    def __init__(self, spec, n_classes, cfg):
        super().__init__()
        m = cfg["model"]
        d = m["d_model"]
        self.embed = Embedder(spec, d)
        self.gru = nn.GRU(d, m["bigru_hidden"], num_layers=m["bigru_layers"],
                          batch_first=True, bidirectional=True,
                          dropout=m["dropout"] if m["bigru_layers"] > 1 else 0.0)
        gdim = 2 * m["bigru_hidden"] + d  # gru pooled + global summary
        self.mlp = nn.Sequential(
            nn.Linear(gdim, d), nn.GELU(), nn.Dropout(m["dropout"]),
        )
        self.chord_head = nn.Linear(d, n_classes)
        self.func_head = nn.Linear(d, 3)

    def forward(self, global_ids, note_feats, note_mask):
        gtok, ntok = self.embed(global_ids, note_feats)
        g_sum = gtok.sum(dim=1)                              # [B, d]
        out, _ = self.gru(ntok)                              # [B, M, 2H]
        mask = note_mask.unsqueeze(-1).float()
        pooled = (out * mask).sum(1) / mask.sum(1).clamp(min=1.0)
        h = self.mlp(torch.cat([pooled, g_sum], dim=1))
        return self.chord_head(h), self.func_head(h)


def build_model(name, spec, n_classes, cfg):
    if name == "transformer":
        return NextChordTransformer(spec, n_classes, cfg)
    if name == "bigru":
        return BiGRUBaseline(spec, n_classes, cfg)
    raise ValueError(name)


def count_params(model):
    return sum(p.numel() for p in model.parameters() if p.requires_grad)
