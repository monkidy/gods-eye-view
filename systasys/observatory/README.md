# World’s Eye V2 — independent Geneva vertical slice

Owner: `monkidy/asso-execution-bridge#4945`, founder mandate comment6597781519.
Build on the existing Cesium fork, camera ground guard, observation normalization
and geographic-resource reader. This directory introduces no new collector or
truth store. The V1 remains available as a previous, separately dated artifact.

`node systasys/observatory/build.mjs` builds the immutable browser bundle and
the dependency-free Node20+ gateway in `release/`. The build records dirty source
as `LOCAL_PROTOTYPE_NOT_RELEASEABLE`; production must reject it. Run
`node --test systasys/observatory/gateway.test.cjs` for boundary checks.

The selected pilot is Geneva Old Town / lakefront: genuine swisstopo roof and
building geometry, swisstopo quantized-mesh terrain and SWISSIMAGE orthophotography.
238 original B3DM paths intersect the fixed building window. The reproducible
metadata-only curator preserves original bounding volumes and geometry. Imagery
covers the immediate surroundings for continuity. Publication revisions are not
capture times. No photogrammetry, live city view or camera everywhere is claimed.

Primary licence / service terms (commercial use permitted, attribution required):

- https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices
- https://www.geo.admin.ch/en/general-terms-of-use-fsdi
- https://docs.geo.admin.ch/visualize-data/3d-tiles.html
- https://docs.geo.admin.ch/visualize-data/terrain-service.html
- https://docs.geo.admin.ch/visualize-data/wmts.html

Credit remains visible: ©swisstopo; CesiumJS; original God's Eye View MIT licence.
Local photographs/cameras come exclusively from the existing SPECTRA reader.
Images open on request. Missing provider response means unknown coverage. Existing
NASA503 remains unresolved; no fallback silently changes that receipt.

The gateway only binds127.0.0.1:5204, only permits fixed GET routes, and proxies
the existing N4 SPECTRA contracts plus three literal official Swiss datasets.
No arbitrary URL, credentials, redirects, finance, broker or command interface.
Bounds: four upstream requests, eight active responses,16 upstream waiters,
360 external reads/minute,18s upstream /35s response deadline,64MiB/512entry
RAM cache,2MiB/s shared output. There is no disk cache, background polling or
collector. Browser hiding destroys its scene and aborts its own reads; resumption
is explicit. Render-on-demand and20/30fps targets bound client rendering.

Deployment must use the existing protected canonical release owner. A separate
private TLS origin on8443 isolates WebGL from N4 on443. N4 contains a launch link.
The DynamicUser unit must have CPUWeight5, Nice15, CPUQuota25%, MemoryHigh192M,
MemoryMax256M, no swap and no access to `/srv/systasys`, `/etc/systasys`, core
installations or home directories. A stopped gateway must leave core units running.
No OVH unit is certified merely by this source or a local build: independent
exact-head review, native CI, official delivery and physical readbacks are separate.
