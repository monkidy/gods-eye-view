# SYSTASYS World’s Eye

Private N4 Cesium client; same-origin, read-only. The original globe, local
NaturalEarthII base and SPECTRA proof filters remain. The local explorer adds:

- existing NASA EONET observations, with exact connector coordinates and separate
  publication/read dates; an old open event is never rejuvenated by a recent read;
- Norwegian public road-camera catalogue and snapshots on request (capture time
  unknown when the source does not supply it);
- Panoramax historical photographs, with author, licence and actual capture date;
- CelesTrak stations, SGP4 calculated positions and dated orbital elements;
- NOAA severe-alert polygon outlines, only until their published expiry;
- NASA GIBS/VIIRS dated daily overview, on request and only with confirmed coverage.

Click the Earth, enter coordinates or choose a preset. Below 150 km camera height,
a stopped zoom discovers nearby metadata after debouncing. Images require an
explicit click; no video or third-party browser connection is made. Absence from
these catalogues is not evidence that a place has no cameras or hazards.

`/n4/api/asso/spectra/geospatial` is implemented inside the canonical repository's
existing N4 server lifecycle. That repository owns the one provider registry,
access mode, budgets, cache, GET-only allowlist, byte/time limits and read receipts.
There is no separate collector, disk datastore, paid API, geocoder or credential.
The globe is denied in workstation mode, where FirmPower may have control rights.

## Reproducible build

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test systasys/model.test.mjs systasys/main.test.mjs systasys/explorer-model.test.mjs
node systasys/build-upstream.mjs
node systasys/build.mjs
```

The entry chunk retains all first-party UI text; the generated dependency engine
is separately cached under `assets/build/`. The native voice guard continues to
inspect the entry; it does not parse minified third-party variable names as French
sentences. Both chunks remain in the immutable SHA-256 asset inventory.

The server bridge bundles the fork's actual camera policy, Panoramax policy,
imagery URL/area validation and TLE parser. MIT licence accompanies it. The build
removes the unused i18n catalogue by verifying and preserving the original
identity `msg` marker; it does not rewrite provider policy. The browser uses the
existing satellite.js dependency for SGP4. N4 pins the exact fork commit and hashes
every shipped browser asset and the private server bridge; no npm build on OVH.

Coverage remains bounded: Norway snapshots, contributor-dependent Panoramax,
stations rather than all orbital objects, severe US weather geometries and
regional daily imagery rather than city-resolution live imagery. Maritime,
aircraft, paid imagery and unrestricted global CCTV are not connected by this lot.
The Cesium base remains a low-resolution geographic reference.

Provider policy reviewed 2026-11-02: NLOD 2.0; Panoramax per-image admitted
licences and attribution; NASA media guidance and NOAA disclaimer; CelesTrak
usage-policy.php (at most one GP read per two hours, stop on HTTP error).
