import {
	App,
	Menu,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
} from "obsidian";

interface ColorEntry {
	name: string;
	color: string;
}

interface ColorTabSettings {
	colors: ColorEntry[];
	/** Maps file path → hex color */
	fileColors: Record<string, string>;
	autoPinColoredTabs: boolean;
	ensureTextContrast: boolean;
	preventTabDuplication: boolean;
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
	autoPinColoredTabs: true,
	ensureTextContrast: false,
	preventTabDuplication: true,
};

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
		this.settings.colors.forEach(({ name, color }) => {
			this.addCommand({
				id: `set-${name.toLowerCase().replace(/\s+/g, "-")}`,			
				name: `Set tab color: ${name}`,
				checkCallback: (checking: boolean) => {
					const leaf = this.app.workspace.getMostRecentLeaf();
					if (!leaf || !this.isColorableLeaf(leaf)) return false;
					if (!checking) this.setTabColor(leaf, color);
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

		menu.addSeparator();

		this.settings.colors.forEach(({ name, color }) => {
			menu.addItem((item) => {
				item.setTitle(name);
				item.onClick(() => this.setTabColor(leaf, color));

				const el = (item as unknown as { dom: HTMLElement }).dom;
				if (el) {
					const swatch = el.createEl("span", { cls: "color-tab-swatch" });
					swatch.style.setProperty("--swatch-color", color);
				}
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

	// ── Color application ─────────────────────────────────────────────────────

	setTabColor(leaf: WorkspaceLeaf, color: string) {
		if (!this.isColorableLeaf(leaf)) return;

		const path = this.getFilePath(leaf);
		if (path) {
			this.settings.fileColors[path] = color;
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
			leaf as unknown as { tabHeaderEl: HTMLElement }
		).tabHeaderEl;
		if (!tabHeader) return;

		if (color) {
			tabHeader.style.setProperty("--tab-bg-color", color);
			tabHeader.classList.add("color-tab-colored");
		} else {
			tabHeader.style.removeProperty("--tab-bg-color");
			tabHeader.classList.remove("color-tab-colored");
		}
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

