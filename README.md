# Color Tab

An [Obsidian](https://obsidian.md) plugin that lets you assign a background color to any open tab, making it easy to visually distinguish notes at a glance.

---

## Why use Color Tab?

When working with several notes simultaneously — researching, cross-referencing, or writing — it can be hard to quickly jump to the right tab. Color Tab lets you **visually tag each tab with a color**, so you can cycle through your open notes faster and reduce mental overhead.

Examples of how people use it:

- 🔴 **Red** – Note you are actively writing
- 🟢 **Green** – Reference material you keep coming back to
- 🟡 **Yellow** – Diagrams supporting my writing
- 🔵 **Blue** – Other useful reference notes
- 🟣 **Lavender** – Meeting notes or daily logs

---

## How to install

### From the Community Plugins directory (recommended)

1. Open Obsidian → **Settings → Community Plugins**.
2. Disable **Safe Mode** if prompted, then select **Browse**.
3. Search for **Color Tab** and click **Install**.
4. Once installed, toggle it **on**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/rordaz/ColorTab/releases/latest).
2. Copy them into your vault at:
   ```
   <your-vault>/.obsidian/plugins/color-tab/
   ```
3. Open Obsidian → **Settings → Community Plugins** and toggle **Color Tab** on.

## How to use

### Assign a color to a tab

1. **Right-click** on any open tab header.
2. The default Obsidian context menu will appear (Close, Pin, etc.).
3. Scroll to the bottom — you will see a separator followed by the 5 color options.
4. Click a color name to apply it. The tab background and title will update immediately.

### Remove a color

1. Right-click the colored tab.
2. Click **Remove tab color** at the bottom of the menu.

### Customize your colors

1. Go to **Settings → Color Tab**.
2. Each of the 5 color slots has a **name field** and a **color picker**.
3. Toggle **Ensure text complies with WCAG 2.1 contrast ratio** to maintain at least 4.5:1 contrast for colored tab titles.
4. Toggle **Prevent Tab Duplication** to keep only one tab per file.
5. Changes take effect immediately — open tabs update live.
6. Click **Reset** to restore the default pastel palette.

## Accessible tab text

The optional WCAG setting keeps the current Obsidian theme's text color whenever it already has sufficient contrast. Otherwise, Color Tab adjusts its lightness while preserving saturation and hue wherever possible. Inactive, hovered, and active tab titles are evaluated separately; tab icons are not changed.

## Default colors

| Slot | Name     | Hex       |
| ---- | -------- | --------- |
| 1    | Red      | `#FFB3BA` |
| 2    | Yellow   | `#FFDFBA` |
| 3    | Green    | `#B5EAD7` |
| 4    | Blue     | `#BAE1FF` |
| 5    | Lavender | `#E2BAFF` |

All defaults are soft pastels so they remain readable in both light and dark themes.

## License

MIT
