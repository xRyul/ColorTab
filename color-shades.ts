export interface ColorShade {
	name: string;
	color: string;
	isCurrent: boolean;
}

interface RgbColor {
	r: number;
	g: number;
	b: number;
}

const SHADE_AMOUNTS = [0.6, 0.4, 0.2];

function parseHexColor(color: string): RgbColor | null {
	const match = /^#([0-9a-f]{6})$/i.exec(color);
	if (!match) return null;

	return {
		r: parseInt(match[1].slice(0, 2), 16),
		g: parseInt(match[1].slice(2, 4), 16),
		b: parseInt(match[1].slice(4, 6), 16),
	};
}

function mixChannel(channel: number, target: number, amount: number): number {
	return Math.round(channel + (target - channel) * amount);
}

function mixColor(color: RgbColor, target: number, amount: number): string {
	return `#${[color.r, color.g, color.b]
		.map((channel) => mixChannel(channel, target, amount))
		.map((channel) => channel.toString(16).padStart(2, "0"))
		.join("")}`.toUpperCase();
}

function createShade(
	name: string,
	color: string,
	currentColor: string
): ColorShade {
	return { name, color, isCurrent: color === currentColor };
}

export function createColorShades(
	baseColor: string,
	currentColor = baseColor
): ColorShade[] {
	const rgb = parseHexColor(baseColor);
	if (!rgb) return [];

	const normalizedBaseColor = baseColor.toUpperCase();
	const normalizedCurrentColor = currentColor.toUpperCase();
	return [
		...SHADE_AMOUNTS.map((amount, index) => {
			const color = mixColor(rgb, 0, amount);
			return createShade(
				`Darker ${SHADE_AMOUNTS.length - index}`,
				color,
				normalizedCurrentColor
			);
		}),
		createShade(
			normalizedBaseColor === normalizedCurrentColor ? "Current" : "Base",
			normalizedBaseColor,
			normalizedCurrentColor
		),
		...SHADE_AMOUNTS.slice().reverse().map((amount, index) => {
			const color = mixColor(rgb, 255, amount);
			return createShade(
				`Lighter ${index + 1}`,
				color,
				normalizedCurrentColor
			);
		}),
	];
}

function colorDistanceSquared(first: RgbColor, second: RgbColor): number {
	return (
		(first.r - second.r) ** 2 +
		(first.g - second.g) ** 2 +
		(first.b - second.b) ** 2
	);
}

export function findColorFamilyIndex(
	paletteColors: string[],
	currentColor: string,
	preferredIndex?: number
): number | null {
	const currentRgb = parseHexColor(currentColor);
	if (!currentRgb) return null;

	// Keep an explicit association stable when palette colors are edited.
	if (
		preferredIndex !== undefined &&
		Number.isInteger(preferredIndex) &&
		preferredIndex >= 0 &&
		preferredIndex < paletteColors.length &&
		parseHexColor(paletteColors[preferredIndex])
	) {
		return preferredIndex;
	}

	// Infer associations for settings saved before palette slots existed.
	const normalizedCurrentColor = currentColor.toUpperCase();
	const exactIndex = paletteColors.findIndex(
		(color) => color.toUpperCase() === normalizedCurrentColor
	);
	if (exactIndex >= 0) return exactIndex;

	const shadeIndex = paletteColors.findIndex((color) =>
		createColorShades(color, currentColor).some(({ isCurrent }) => isCurrent)
	);
	if (shadeIndex >= 0) return shadeIndex;

	// Older builds could shade an already shaded color; recover its nearest family.
	let closestIndex: number | null = null;
	let closestDistance = Number.POSITIVE_INFINITY;
	paletteColors.forEach((color, index) => {
		const paletteRgb = parseHexColor(color);
		if (!paletteRgb) return;

		const distance = colorDistanceSquared(currentRgb, paletteRgb);
		if (distance < closestDistance) {
			closestIndex = index;
			closestDistance = distance;
		}
	});
	return closestIndex;
}
