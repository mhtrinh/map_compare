# Map Compare

**[Live at https://mhtrinh.github.io/map_compare/](https://mhtrinh.github.io/map_compare/)**

The idea: when you read that a city covers X km², it's hard to grasp what that means. Draw the outline of a city you know, then drag it over another city to see how they compare at real-world scale.

## Features

- **Draw polygons** on an OpenStreetMap base layer with click-to-place vertices
- **Rotate and drag** shapes to compare distances and areas across locations
- **Bookmark** map positions with auto-named labels (reverse geocoded)
- **Share** the full state (polygon, bookmarks, map view) via a URL hash link

## Usage

Serve the project directory with any static HTTP server. A convenience script is included (require nginx):

```bash
./start.sh
# Serves at http://localhost:3333
```

Open the page and use the toolbar in the top-right corner:

| Button | Action |
|--------|--------|
| Pencil | Switch to Draw mode (click to place vertices, double-click to close) |
| Map | Switch to Navigation mode (pan and zoom the map) |
| Pin | Bookmark the current map view |
| Link | Copy a shareable URL to clipboard |
| Trash | Delete all drawn points (Draw mode only) |

Use the rotation slider to rotate the polygon. In Draw mode, drag vertices to reshape, drag the polygon body to reposition, or use the orange rotation handle.

## Dependencies

- [Leaflet](https://leafletjs.com/) 1.9.4 (loaded from CDN)
- [OpenStreetMap](https://www.openstreetmap.org/) tiles and Nominatim for reverse geocoding

## License

[MIT](LICENSE)
