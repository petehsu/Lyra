# Lyra Image Codec Boundary

The image viewer native core is prepared for vendored permissive codec backends.
The OpenImageIO bridge is optional at build time and links only when a local or
bundled OpenImageIO installation is discoverable. Vendored codec drops should
live under this directory with their upstream license text mirrored in
`legal/third-party/image-codecs`.
