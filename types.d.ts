import "obsidian";

declare module "obsidian" {
	interface MenuItem {
		setSubmenu(): Menu;
	}
}
