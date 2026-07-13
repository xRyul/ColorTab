import {
	App,
	Menu,
	MenuItem,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
} from "obsidian";
import {
	darkenColor,
	ensureTextContrast,
	parseHexColor,
	toCssColor,
} from "./color-contrast";
import type { RgbColor, RgbaColor } from "./color-contrast";
import { createColorShades, findColorFamilyIndex } from "./color-shades";

interface ColorEntry {
	name: string;
	color: string;
}

interface ColorTabSettings {
	colors: ColorEntry[];
	/** Maps file path → hex color */
	fileColors: Record<string, string>;
	/** Maps file path → configured palette slot */
	fileColorSlots: Record<string, number>;
	autoPinColoredTabs: boolean;
	ensureTextContrast: boolean;
	preventTabDuplication: boolean;
}

interface ThemeTabTextColors {
	normal: RgbaColor;
	focused: RgbaColor;
	hover: RgbaColor;
	focusedHover: RgbaColor;
	active: RgbaColor;
	focusedActive: RgbaColor;
	focusedActiveCurrent: RgbaColor;
}

const DEFAULT_COLORS: ColorEntry[] = [
	{ name: "Red",      color: "#FFB3BA" },
	{ name: "Yellow",   color: "#FFDFBA" },
	{ name: "Green",    color: "#B5EAD7" },
	{ name: "Blue",     color: "#BAE1FF" },
	{ name: "Lavender", color: "#E2BAFF" },
];

const DEFAULT_SETTINGS: ColorTabSettings = {
	colors: DEFAULT_COLORS,
	fileColors: {},
	fileColorSlots: {},
	autoPinColoredTabs: true,
	ensureTextContrast: false,
	preventTabDuplication: true,
};

const TEXT_CONTRAST_CLASS = "color-tab-wcag";
const TEXT_CONTRAST_PROPERTIES = [
	"--tab-bg-color-hover",
	"--tab-bg-color-active",
	"--color-tab-text",
	"--color-tab-text-focused",
	"--color-tab-text-hover",
	"--color-tab-text-focused-hover",
	"--color-tab-text-active",
	"--color-tab-text-focused-active",
	"--color-tab-text-focused-active-current",
] as const;

export default class ColorTabPlugin extends Plugin {
	settings!: ColorTabSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ColorTabSettingTab(this.app, this));

		// Append color options to Obsidian's native tab context menu
		this.registerEvent(
			this.app.workspace.on(
				"file-menu",
				(menu, _file, source, leaf) => {
					if (source !== "tab-header" || !leaf) return;
					console.log("[ColorTab DEBUG]", {
						source,
						filePath: this.getFilePath(leaf),
						viewType: leaf.getViewState().type,
						isColorable: this.isColorableLeaf(leaf),
						root: leaf.getRoot(),
						wsLeftSplit: (this.app.workspace as unknown as { leftSplit: unknown }).leftSplit,
						wsRightSplit: (this.app.workspace as unknown as { rightSplit: unknown }).rightSplit,
					});
					this.addColorMenuItems(menu, leaf);
				}
			)
		);

		// Re-apply stored colors whenever the layout changes
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.applyAllColors();
				if (this.settings.preventTabDuplication) {
					this.handleDuplicateTabs();
				}
			})
		);

		// Clear/apply color when a new file is loaded into any leaf
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.applyAllColors();
				if (this.settings.preventTabDuplication) {
					this.handleDuplicateTabs();
				}
			})
		);

		// Theme changes can alter the preferred tab text colors.
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				if (this.settings.ensureTextContrast) this.applyAllColors();
			})
		);

		this.app.workspace.onLayoutReady(() => {
			this.applyAllColors();
			if (this.settings.preventTabDuplication) {
				this.handleDuplicateTabs();
			}
			this.registerColorCommands();
		});
	}

	// ── Commands (hotkeys) ────────────────────────────────────────────────────

	private registerColorCommands() {
		this.settings.colors.forEach(({ name, color }, colorIndex) => {
			this.addCommand({
				id: `set-${name.toLowerCase().replace(/\s+/g, "-")}`,
				name: `Set tab color: ${name}`,
				checkCallback: (checking: boolean) => {
					const leaf = this.app.workspace.getMostRecentLeaf();
					if (!leaf || !this.isColorableLeaf(leaf)) return false;
					if (!checking) this.setTabColor(leaf, color, colorIndex);
					return true;
				},
			});
		});

		this.addCommand({
			id: "remove",
			name: "Remove tab color",
			checkCallback: (checking: boolean) => {
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!leaf || !this.isColorableLeaf(leaf)) return false;
				if (!checking) this.removeTabColor(leaf);
				return true;
			},
		});

		this.addCommand({
			id: "remove-all",
			name: "Remove all tabs' color",
			callback: () => this.removeAllTabColors(),
		});
	}

	// ── Context menu ──────────────────────────────────────────────────────────

	private addColorMenuItems(menu: Menu, leaf: WorkspaceLeaf) {
		if (!this.isColorableLeaf(leaf)) return;

		const path = this.getFilePath(leaf);
		const currentColor = path ? this.settings.fileColors[path] : undefined;
		const selectedColorIndex = currentColor
			? findColorFamilyIndex(
				this.settings.colors.map(({ color }) => color),
				currentColor,
				path ? this.settings.fileColorSlots[path] : undefined
			)
			: null;

		menu.addSeparator();

		this.settings.colors.forEach((colorEntry, colorIndex) => {
			const { name, color } = colorEntry;
			const shades =
				currentColor && colorIndex === selectedColorIndex
					? createColorShades(color, currentColor)
					: [];
			const hasShadeSubmenu = shades.length > 0;

			menu.addItem((item) => {
				item.setTitle(name);
				if (hasShadeSubmenu) {
					const submenu = item.setSubmenu();
					shades.forEach(({ name, color, isCurrent }) => {
						submenu.addItem((shadeItem) => {
							shadeItem
								.setTitle(name)
								.setChecked(isCurrent)
								.onClick(() =>
									this.setTabColor(leaf, color, colorIndex)
								);
							this.addColorSwatch(shadeItem, color);
						});
					});
				} else {
					item.onClick(() => this.setTabColor(leaf, color, colorIndex));
				}
				this.addColorSwatch(item, color);
			});
		});

		menu.addItem((item) => {
			item.setTitle("Remove tab color");
			item.setIcon("x");
			item.onClick(() => this.removeTabColor(leaf));
		});

		menu.addItem((item) => {
			item.setTitle("Remove all tabs' color");
			item.setIcon("x-circle");
			item.onClick(() => this.removeAllTabColors());
		});
	}

	private addColorSwatch(item: MenuItem, color: string) {
		const el = (item as unknown as { dom?: HTMLElement }).dom;
		if (!el) return;

		const swatch = el.createEl("span", { cls: "color-tab-swatch" });
		swatch.style.setProperty("--swatch-color", color);
	}

	// ── Color application ─────────────────────────────────────────────────────

	setTabColor(
		leaf: WorkspaceLeaf,
		color: string,
		preferredColorSlot?: number
	) {
		if (!this.isColorableLeaf(leaf)) return;

		const path = this.getFilePath(leaf);
		if (path) {
			this.settings.fileColors[path] = color;
			const resolvedColorSlot = findColorFamilyIndex(
				this.settings.colors.map((entry) => entry.color),
				color,
				preferredColorSlot
			);
			if (resolvedColorSlot === null) {
				delete this.settings.fileColorSlots[path];
			} else {
				this.settings.fileColorSlots[path] = resolvedColorSlot;
			}
			void this.saveSettings();
		}
		this.applyColorToLeaf(leaf, color);
		if (this.settings.autoPinColoredTabs) {
			leaf.setPinned(true);
		}
	}

	removeTabColor(leaf: WorkspaceLeaf) {
		if (!this.isColorableLeaf(leaf)) return;

		const path = this.getFilePath(leaf);
		if (path) {
			delete this.settings.fileColors[path];
			delete this.settings.fileColorSlots[path];
			void this.saveSettings();
		}
		this.applyColorToLeaf(leaf, null);
		if (this.settings.autoPinColoredTabs) {
			leaf.setPinned(false);
		}
	}

	removeAllTabColors() {
		const coloredPaths = new Set(Object.keys(this.settings.fileColors));
		this.settings.fileColors = {};
		this.settings.fileColorSlots = {};
		void this.saveSettings();
		this.app.workspace.iterateAllLeaves((leaf) => {
			this.applyColorToLeaf(leaf, null);
			const path = this.getFilePath(leaf);
			if (
				this.settings.autoPinColoredTabs &&
				path &&
				coloredPaths.has(path)
			) {
				leaf.setPinned(false);
			}
		});
	}

	applyColorToLeaf(leaf: WorkspaceLeaf, color: string | null) {
		const tabHeader = (
			leaf as unknown as { tabHeaderEl?: HTMLElement }
		).tabHeaderEl;
		if (!tabHeader) return;

		this.clearTextContrastStyles(tabHeader);
		if (color) {
			tabHeader.style.setProperty("--tab-bg-color", color);
			tabHeader.classList.add("color-tab-colored");
			if (this.settings.ensureTextContrast) {
				this.applyTextContrastToTab(tabHeader, color);
			}
		} else {
			tabHeader.style.removeProperty("--tab-bg-color");
			tabHeader.classList.remove("color-tab-colored");
		}
	}

	private applyTextContrastToTab(tabHeader: HTMLElement, color: string) {
		const background = parseHexColor(color);
		const themeText = this.readThemeTabTextColors(tabHeader);
		if (!background || !themeText) return;

		const hoverBackground = darkenColor(background, 0.92);
		// Active tabs retain their assigned color; only inactive hover is darkened.
		const activeBackground = background;
		const setTextColor = (
			property: string,
			preferred: RgbaColor,
			stateBackground: RgbColor
		) => {
			tabHeader.style.setProperty(
				property,
				toCssColor(ensureTextContrast(preferred, stateBackground))
			);
		};

		tabHeader.style.setProperty(
			"--tab-bg-color-hover",
			toCssColor({ ...hoverBackground, a: 1 })
		);
		tabHeader.style.setProperty(
			"--tab-bg-color-active",
			toCssColor({ ...activeBackground, a: 1 })
		);
		setTextColor("--color-tab-text", themeText.normal, background);
		setTextColor(
			"--color-tab-text-focused",
			themeText.focused,
			background
		);
		setTextColor(
			"--color-tab-text-hover",
			themeText.hover,
			hoverBackground
		);
		setTextColor(
			"--color-tab-text-focused-hover",
			themeText.focusedHover,
			hoverBackground
		);
		setTextColor(
			"--color-tab-text-active",
			themeText.active,
			activeBackground
		);
		setTextColor(
			"--color-tab-text-focused-active",
			themeText.focusedActive,
			activeBackground
		);
		setTextColor(
			"--color-tab-text-focused-active-current",
			themeText.focusedActiveCurrent,
			activeBackground
		);
		tabHeader.classList.add(TEXT_CONTRAST_CLASS);
	}

	private clearTextContrastStyles(tabHeader: HTMLElement) {
		tabHeader.classList.remove(TEXT_CONTRAST_CLASS);
		TEXT_CONTRAST_PROPERTIES.forEach((property) => {
			tabHeader.style.removeProperty(property);
		});
	}

	private readThemeTabTextColors(
		tabHeader: HTMLElement
	): ThemeTabTextColors | null {
		const titleEl = tabHeader.querySelector<HTMLElement>(
			".workspace-tab-header-inner-title"
		);
		const doc = tabHeader.ownerDocument;
		const view = doc.defaultView;
		if (!titleEl || !view) return null;

		const canvas = doc.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) return null;

		const currentCssColor = view.getComputedStyle(titleEl).color;
		const currentColor = this.readCssColor(context, currentCssColor);
		const probe = doc.createElement("span");
		probe.style.position = "absolute";
		probe.style.visibility = "hidden";
		probe.style.pointerEvents = "none";
		tabHeader.appendChild(probe);

		const resolveThemeVariable = (property: string): RgbaColor => {
			probe.style.color = `var(${property}, ${currentCssColor})`;
			const resolved = view.getComputedStyle(probe).color;
			return this.readCssColor(context, resolved) ?? currentColor;
		};
		const normal = resolveThemeVariable("--tab-text-color");
		const focused = resolveThemeVariable("--tab-text-color-focused");
		const colors: ThemeTabTextColors = {
			normal,
			focused,
			hover: normal,
			focusedHover: focused,
			active: resolveThemeVariable("--tab-text-color-active"),
			focusedActive: resolveThemeVariable(
				"--tab-text-color-focused-active"
			),
			focusedActiveCurrent: resolveThemeVariable(
				"--tab-text-color-focused-active-current"
			),
		};
		probe.remove();

		// Prefer a theme's direct selector override for the tab's current state.
		const isFocused = doc.body.classList.contains("is-focused");
		const isActive = tabHeader.classList.contains("is-active");
		const isHovered = tabHeader.matches(":hover");
		if (isActive) {
			if (isFocused && tabHeader.closest(".mod-active")) {
				colors.focusedActiveCurrent = currentColor;
			} else if (isFocused) {
				colors.focusedActive = currentColor;
			} else {
				colors.active = currentColor;
			}
		} else if (isFocused && isHovered) {
			colors.focusedHover = currentColor;
		} else if (isFocused) {
			colors.focused = currentColor;
		} else if (isHovered) {
			colors.hover = currentColor;
		} else {
			colors.normal = currentColor;
		}

		return colors;
	}

	private readCssColor(
		context: CanvasRenderingContext2D,
		cssColor: string
	): RgbaColor {
		context.clearRect(0, 0, 1, 1);
		context.fillStyle = cssColor;
		context.fillRect(0, 0, 1, 1);
		const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
		return { r, g, b, a: alpha / 255 };
	}

	applyAllColors() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!this.isColorableLeaf(leaf)) {
				// Strip any color/pin previously applied by this plugin to sidebar leaves
				const tabHeader = (
					leaf as unknown as { tabHeaderEl?: HTMLElement }
				).tabHeaderEl;
				if (tabHeader?.classList.contains("color-tab-colored")) {
					this.applyColorToLeaf(leaf, null);
					if (this.settings.autoPinColoredTabs) leaf.setPinned(false);
				}
				return;
			}
			const path = this.getFilePath(leaf)!;
			const color = this.settings.fileColors[path] ?? null;
			this.applyColorToLeaf(leaf, color);
			if (this.settings.autoPinColoredTabs && color) {
				leaf.setPinned(true);
			}
		});
	}

	// ── Tab duplication prevention ────────────────────────────────────────────

	/**
	 * Detects and handles duplicate tabs (same file open in multiple tabs).
	 * Closes duplicate tabs and focuses on the first instance.
	 * Works with both regular and colored (pinned) tabs.
	 */
	private handleDuplicateTabs() {
		const filePathMap = new Map<string, WorkspaceLeaf[]>();

		// Build a map of file paths to their corresponding document leaves only.
		// Sidebar views (Outline, File Properties, Backlinks, etc.) can be
		// file-aware, but are not file document tabs and must never be closed.
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!this.isColorableLeaf(leaf)) return;
			const path = this.getFilePath(leaf);
			if (path) {
				if (!filePathMap.has(path)) {
					filePathMap.set(path, []);
				}
				filePathMap.get(path)!.push(leaf);
			}
		});

		// For each file with duplicates, keep the first and close the rest
		filePathMap.forEach((leaves) => {
			if (leaves.length > 1) {
				// Keep the first leaf and focus on it
				const firstLeaf = leaves[0];
				this.app.workspace.setActiveLeaf(firstLeaf);

				// Close the duplicate leaves
				for (let i = 1; i < leaves.length; i++) {
					const duplicateLeaf = leaves[i];
					// Unpin the duplicate tab before closing it (important for colored tabs)
					duplicateLeaf.setPinned(false);
					duplicateLeaf.detach();
				}
			}
		});
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private getFilePath(leaf: WorkspaceLeaf): string | null {
		// Loaded views expose their file directly.
		const fileFromView = (leaf.view as unknown as { file?: { path: string } })
			?.file;
		if (fileFromView?.path) return fileFromView.path;

		// Excalidraw can store the file directly on the leaf.
		const fileFromLeaf = (leaf as unknown as { file?: { path: string } })
			?.file;
		if (fileFromLeaf?.path) return fileFromLeaf.path;

		// Background tabs can be deferred after startup, leaving view.file unset.
		const fileFromState = leaf.getViewState().state?.file;
		return typeof fileFromState === "string" && fileFromState.length > 0
			? fileFromState
			: null;
	}

	private isColorableLeaf(leaf: WorkspaceLeaf): boolean {
		if (this.getFilePath(leaf) === null) return false;
		// Exclude sidebar leaves (Outline, File Properties, Backlinks, etc.)
		// which are file-aware but must not be colored.
		// Allow leaves in the main window AND in any popout window.
		const root = leaf.getRoot();
		const ws = this.app.workspace as unknown as {
			leftSplit: unknown;
			rightSplit: unknown;
		};
		if (root === ws.leftSplit || root === ws.rightSplit) return false;
		// Only color markdown/file/excalidraw document tabs, not auxiliary views
		// (local graph, graph, properties, etc.)
		const viewType = leaf.getViewState().type;
		if (viewType !== "markdown" && viewType !== "file" && viewType !== "excalidraw") return false;
		return true;
	}

	// ── Settings persistence ──────────────────────────────────────────────────

	async loadSettings() {
		const saved = await this.loadData() as Partial<ColorTabSettings> | null;
		this.settings = {
			colors: saved?.colors ?? DEFAULT_COLORS.map((c) => ({ ...c })),
			fileColors: saved?.fileColors ?? {},
			fileColorSlots: saved?.fileColorSlots ?? {},
			autoPinColoredTabs: saved?.autoPinColoredTabs ?? DEFAULT_SETTINGS.autoPinColoredTabs,
			ensureTextContrast: saved?.ensureTextContrast ?? DEFAULT_SETTINGS.ensureTextContrast,
			preventTabDuplication: saved?.preventTabDuplication ?? DEFAULT_SETTINGS.preventTabDuplication,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// ── Settings tab ──────────────────────────────────────────────────────────────

class ColorTabSettingTab extends PluginSettingTab {
	plugin: ColorTabPlugin;

	constructor(app: App, plugin: ColorTabPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Primary: used by Obsidian 1.13.0+. When this returns a non-empty array,
	// display() is not called by the framework.
	getSettingDefinitions() {
		const colorRows = this.plugin.settings.colors.map((entry, index) => ({
			name: `Color ${index + 1}`,
			render: (setting: Setting) => {
				let hexInputEl: HTMLInputElement;
				let colorPickerEl: HTMLInputElement;
				let swatchEl: HTMLSpanElement;

				setting
					// ── Meaning / name field ──────────────────────────────
					.addText((text) => {
						text.setPlaceholder("Meaning")
							.setValue(entry.name)
							.onChange(async (value) => {
								this.plugin.settings.colors[index].name = value;
								await this.plugin.saveSettings();
							});
						text.inputEl.setCssStyles({ width: "120px" });
						text.inputEl.setAttribute("aria-label", "Color meaning / name");
					})
					// ── Hex code text input ───────────────────────────────
					.addText((hex) => {
						hex.setPlaceholder("#rrggbb")
							.setValue(entry.color)
							.onChange(async (value) => {
								const normalized = value.trim();
								if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return;
								this.plugin.settings.colors[index].color = normalized;
								await this.plugin.saveSettings();
								this.plugin.applyAllColors();
								if (colorPickerEl) colorPickerEl.value = normalized;
								if (swatchEl) swatchEl.style.backgroundColor = normalized;
							});
						hex.inputEl.setCssStyles({ width: "88px", fontFamily: "monospace" });
						hex.inputEl.setAttribute("aria-label", "Hex color code");
						hexInputEl = hex.inputEl;
					})
					// ── Color picker ──────────────────────────────────────
					.addColorPicker((picker) => {
						picker
							.setValue(entry.color)
							.onChange(async (value) => {
								this.plugin.settings.colors[index].color = value;
								await this.plugin.saveSettings();
								this.plugin.applyAllColors();
								if (hexInputEl) hexInputEl.value = value;
								if (swatchEl) swatchEl.style.backgroundColor = value;
							});
					});

				// Live swatch preview
				swatchEl = setting.controlEl.createEl("span", {
					cls: "color-tab-settings-swatch",
				});
				swatchEl.style.backgroundColor = entry.color;

				// Grab the native <input type="color"> for cross-sync
				colorPickerEl = setting.controlEl.querySelector(
					"input[type=color]"
				) as HTMLInputElement;

				colorPickerEl?.addEventListener("input", () => {
					if (hexInputEl) hexInputEl.value = colorPickerEl.value;
					if (swatchEl) swatchEl.style.backgroundColor = colorPickerEl.value;
				});
			},
		}));

		return [
			...colorRows,
			{
				name: "Auto-pin colored tabs",
				desc: "When enabled, applying a tab color pins the tab and removing color unpins it.",
				render: (setting: Setting) => {
					setting.addToggle((toggle) => {
						toggle
							.setValue(this.plugin.settings.autoPinColoredTabs)
							.onChange(async (value) => {
								this.plugin.settings.autoPinColoredTabs = value;
								await this.plugin.saveSettings();
								this.plugin.applyAllColors();
							});
					});
				},
			},
			{
				name: "Ensure text complies with WCAG 2.1 contrast ratio",
				desc: "Automatically adjusts colored tab titles to meet the WCAG 2.1 AA minimum contrast ratio of 4.5:1.",
				render: (setting: Setting) => {
					setting.addToggle((toggle) => {
						toggle
							.setValue(this.plugin.settings.ensureTextContrast)
							.onChange(async (value) => {
								this.plugin.settings.ensureTextContrast = value;
								await this.plugin.saveSettings();
								this.plugin.applyAllColors();
							});
					});
				},
			},
			{
				name: "Prevent Tab Duplication",
				desc: "When enabled, opening an already-open file will focus on the existing tab instead of creating a duplicate.",
				render: (setting: Setting) => {
					setting.addToggle((toggle) => {
						toggle
							.setValue(this.plugin.settings.preventTabDuplication)
							.onChange(async (value) => {
								this.plugin.settings.preventTabDuplication = value;
								await this.plugin.saveSettings();
							});
					});
				},
			},
			{
				name: "Reset to defaults",
				desc: "Restore the original pastel color palette.",
				render: (setting: Setting) => {
					setting.addButton((btn) => {
						btn.buttonEl.addClass("mod-destructive");
						btn.setButtonText("Reset")
							.onClick(async () => {
								this.plugin.settings.colors = DEFAULT_COLORS.map(
									(c) => ({ ...c })
								);
								this.plugin.settings.autoPinColoredTabs =
									DEFAULT_SETTINGS.autoPinColoredTabs;
								this.plugin.settings.ensureTextContrast =
									DEFAULT_SETTINGS.ensureTextContrast;
								this.plugin.settings.preventTabDuplication =
									DEFAULT_SETTINGS.preventTabDuplication;
								await this.plugin.saveSettings();
								this.plugin.applyAllColors();
								this.display();
							});
					});
				},
			},
		];
	}

	// Fallback for Obsidian versions that do not consume getSettingDefinitions.
	display() {
		const { containerEl } = this;
		containerEl.empty();

		this.plugin.settings.colors.forEach((entry, index) => {
			let hexInputEl: HTMLInputElement;
			let colorPickerEl: HTMLInputElement;
			let swatchEl: HTMLSpanElement;

			const setting = new Setting(containerEl)
				.setName(`Color ${index + 1}`)
				.addText((text) => {
					text.setPlaceholder("Meaning")
						.setValue(entry.name)
						.onChange(async (value) => {
							this.plugin.settings.colors[index].name = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.setCssStyles({ width: "120px" });
					text.inputEl.setAttribute("aria-label", "Color meaning / name");
				})
				.addText((hex) => {
					hex.setPlaceholder("#rrggbb")
						.setValue(entry.color)
						.onChange(async (value) => {
							const normalized = value.trim();
							if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return;
							this.plugin.settings.colors[index].color = normalized;
							await this.plugin.saveSettings();
							this.plugin.applyAllColors();
							if (colorPickerEl) colorPickerEl.value = normalized;
							if (swatchEl) swatchEl.style.backgroundColor = normalized;
						});
					hex.inputEl.setCssStyles({ width: "88px", fontFamily: "monospace" });
					hex.inputEl.setAttribute("aria-label", "Hex color code");
					hexInputEl = hex.inputEl;
				})
				.addColorPicker((picker) => {
					picker
						.setValue(entry.color)
						.onChange(async (value) => {
							this.plugin.settings.colors[index].color = value;
							await this.plugin.saveSettings();
							this.plugin.applyAllColors();
							if (hexInputEl) hexInputEl.value = value;
							if (swatchEl) swatchEl.style.backgroundColor = value;
						});
				});

			swatchEl = setting.controlEl.createEl("span", {
				cls: "color-tab-settings-swatch",
			});
			swatchEl.style.backgroundColor = entry.color;

			colorPickerEl = setting.controlEl.querySelector(
				"input[type=color]"
			) as HTMLInputElement;

			colorPickerEl?.addEventListener("input", () => {
				if (hexInputEl) hexInputEl.value = colorPickerEl.value;
				if (swatchEl) swatchEl.style.backgroundColor = colorPickerEl.value;
			});
		});

		new Setting(containerEl)
			.setName("Auto-pin colored tabs")
			.setDesc(
				"When enabled, applying a tab color pins the tab and removing color unpins it."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoPinColoredTabs)
					.onChange(async (value) => {
						this.plugin.settings.autoPinColoredTabs = value;
						await this.plugin.saveSettings();
						this.plugin.applyAllColors();
					});
			});

		new Setting(containerEl)
			.setName("Ensure text complies with WCAG 2.1 contrast ratio")
			.setDesc(
				"Automatically adjusts colored tab titles to meet the WCAG 2.1 AA minimum contrast ratio of 4.5:1."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.ensureTextContrast)
					.onChange(async (value) => {
						this.plugin.settings.ensureTextContrast = value;
						await this.plugin.saveSettings();
						this.plugin.applyAllColors();
					});
			});

		new Setting(containerEl)
			.setName("Prevent Tab Duplication")
			.setDesc(
				"When enabled, opening an already-open file will focus on the existing tab instead of creating a duplicate."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.preventTabDuplication)
					.onChange(async (value) => {
						this.plugin.settings.preventTabDuplication = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Reset to defaults")
			.setDesc("Restore the original pastel color palette.")
			.addButton((btn) => {
				btn.buttonEl.addClass("mod-destructive");
				btn.setButtonText("Reset")
					.onClick(async () => {
						this.plugin.settings.colors = DEFAULT_COLORS.map(
							(c) => ({ ...c })
						);
						this.plugin.settings.autoPinColoredTabs =
							DEFAULT_SETTINGS.autoPinColoredTabs;
						this.plugin.settings.ensureTextContrast =
							DEFAULT_SETTINGS.ensureTextContrast;
						this.plugin.settings.preventTabDuplication =
							DEFAULT_SETTINGS.preventTabDuplication;
						await this.plugin.saveSettings();
						this.plugin.applyAllColors();
						this.display();
					});
			});
	}

}

