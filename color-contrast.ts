export interface RgbColor {
	r: number;
	g: number;
	b: number;
}

export interface RgbaColor extends RgbColor {
	a: number;
}

interface HslColor {
	h: number;
	s: number;
	l: number;
}

export const WCAG_AA_NORMAL_TEXT_RATIO = 4.5;

const LIGHTNESS_STEPS = 1000;

export function parseHexColor(hex: string): RgbColor | null {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!match) return null;

	return {
		r: parseInt(match[1], 16),
		g: parseInt(match[2], 16),
		b: parseInt(match[3], 16),
	};
}

export function darkenColor(color: RgbColor, factor: number): RgbColor {
	return {
		r: clampByte(color.r * factor),
		g: clampByte(color.g * factor),
		b: clampByte(color.b * factor),
	};
}

export function contrastRatio(foreground: RgbColor, background: RgbColor): number {
	const foregroundLuminance = relativeLuminance(foreground);
	const backgroundLuminance = relativeLuminance(background);
	const lighter = Math.max(foregroundLuminance, backgroundLuminance);
	const darker = Math.min(foregroundLuminance, backgroundLuminance);
	return (lighter + 0.05) / (darker + 0.05);
}

export function ensureTextContrast(
	preferred: RgbaColor,
	background: RgbColor,
	minimumRatio = WCAG_AA_NORMAL_TEXT_RATIO
): RgbaColor {
	if (getRenderedContrast(preferred, background) >= minimumRatio) {
		return preferred;
	}

	// Changing HSL lightness spans the full black-to-white range while retaining
	// the theme color's saturation and hue everywhere between those endpoints.
	const withOriginalAlpha = findClosestCompliantLightness(
		preferred,
		background,
		minimumRatio,
		preferred.a
	);
	if (withOriginalAlpha) return withOriginalAlpha;

	// Very translucent theme text may not be able to reach the target ratio.
	// Make it opaque before considering any change to saturation or hue.
	const opaque = findClosestCompliantLightness(
		preferred,
		background,
		minimumRatio,
		1
	);
	if (opaque) return opaque;

	// Opaque black or white always satisfies 4.5:1 against an opaque color;
	// retain this defensive fallback for floating-point and browser edge cases.
	const black: RgbaColor = { r: 0, g: 0, b: 0, a: 1 };
	const white: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
	return getRenderedContrast(black, background) >=
		getRenderedContrast(white, background)
		? black
		: white;
}

export function toCssColor(color: RgbaColor): string {
	const red = clampByte(color.r);
	const green = clampByte(color.g);
	const blue = clampByte(color.b);
	const alpha = clamp(color.a, 0, 1);
	return alpha === 1
		? `rgb(${red}, ${green}, ${blue})`
		: `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function findClosestCompliantLightness(
	preferred: RgbaColor,
	background: RgbColor,
	minimumRatio: number,
	alpha: number
): RgbaColor | null {
	const original = rgbToHsl(preferred);
	let best: RgbaColor | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	let bestContrast = 0;

	for (let step = 0; step <= LIGHTNESS_STEPS; step++) {
		const lightness = step / LIGHTNESS_STEPS;
		const distance = Math.abs(lightness - original.l);
		if (distance > bestDistance) continue;

		const rgb = hslToRgb({ ...original, l: lightness });
		const candidate = { ...rgb, a: alpha };
		const candidateContrast = getRenderedContrast(candidate, background);
		if (candidateContrast < minimumRatio) continue;

		if (distance < bestDistance || candidateContrast > bestContrast) {
			best = candidate;
			bestDistance = distance;
			bestContrast = candidateContrast;
		}
	}

	return best;
}

function getRenderedContrast(foreground: RgbaColor, background: RgbColor): number {
	return contrastRatio(compositeColor(foreground, background), background);
}

function compositeColor(foreground: RgbaColor, background: RgbColor): RgbColor {
	const alpha = clamp(foreground.a, 0, 1);
	return {
		r: foreground.r * alpha + background.r * (1 - alpha),
		g: foreground.g * alpha + background.g * (1 - alpha),
		b: foreground.b * alpha + background.b * (1 - alpha),
	};
}

function relativeLuminance(color: RgbColor): number {
	const red = linearize(color.r / 255);
	const green = linearize(color.g / 255);
	const blue = linearize(color.b / 255);
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function linearize(channel: number): number {
	return channel <= 0.03928
		? channel / 12.92
		: Math.pow((channel + 0.055) / 1.055, 2.4);
}

function rgbToHsl(color: RgbColor): HslColor {
	const red = color.r / 255;
	const green = color.g / 255;
	const blue = color.b / 255;
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const lightness = (max + min) / 2;
	const delta = max - min;

	if (delta === 0) return { h: 0, s: 0, l: lightness };

	const saturation = delta / (1 - Math.abs(2 * lightness - 1));
	let hue: number;
	if (max === red) {
		hue = ((green - blue) / delta) % 6;
	} else if (max === green) {
		hue = (blue - red) / delta + 2;
	} else {
		hue = (red - green) / delta + 4;
	}

	return {
		h: ((hue * 60) + 360) % 360,
		s: saturation,
		l: lightness,
	};
}

function hslToRgb(color: HslColor): RgbColor {
	const chroma = (1 - Math.abs(2 * color.l - 1)) * color.s;
	const hueSegment = color.h / 60;
	const secondary = chroma * (1 - Math.abs((hueSegment % 2) - 1));
	let red = 0;
	let green = 0;
	let blue = 0;

	if (hueSegment < 1) {
		red = chroma;
		green = secondary;
	} else if (hueSegment < 2) {
		red = secondary;
		green = chroma;
	} else if (hueSegment < 3) {
		green = chroma;
		blue = secondary;
	} else if (hueSegment < 4) {
		green = secondary;
		blue = chroma;
	} else if (hueSegment < 5) {
		red = secondary;
		blue = chroma;
	} else {
		red = chroma;
		blue = secondary;
	}

	const match = color.l - chroma / 2;
	return {
		r: clampByte((red + match) * 255),
		g: clampByte((green + match) * 255),
		b: clampByte((blue + match) * 255),
	};
}

function clampByte(value: number): number {
	return Math.round(clamp(value, 0, 255));
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
