# data-build

Reproducible build of the place directory in `src/lib/gz`.

```bash
./fetch.sh raw
python3 -I build.py raw .
COAST_PTS=raw/coast_pts.npy python3 -I validate.py .
```

`PROVENANCE.md` lists inputs, fingerprints and the output schema. `*.sources.json` give row-level provenance, `build-stats.json` every drop reason, and `validate-output.txt` the last validation run.
