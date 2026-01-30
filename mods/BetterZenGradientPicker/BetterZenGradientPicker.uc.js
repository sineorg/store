// ==UserScript==
// @name           BetterZenGradientPicker
// @version        1.3
// @description    A Sine mod which aims to overhaul Zen's gradient picker with tons of new features :))
// @author         JustAdumbPrsn
// @include        main
// ==/UserScript==

/**
 * ZenPickerMods - Main Controller
 */
const ZenPickerMods = {
    modules: [],

    init() {
        this.log("Initializing Main Controller...");
        const pm = new PaletteModule();
        this.modules.push(new OpacityModule());
        this.modules.push(new HarmonyModule());
        this.modules.push(new RotationModule());
        this.modules.push(pm);
        this.modules.push(new FavoritesModule());

        // Expose PaletteModule for fastProjectLightness usage
        this.paletteMod = pm;

        this.waitForZen();
    },

    waitForZen() {
        let retryCount = 0;
        const interval = setInterval(() => {
            if (window.gZenThemePicker && window.gZenWorkspaces?.promiseInitialized) {
                clearInterval(interval);
                window.gZenWorkspaces.promiseInitialized.then(() => {
                    this.startModules(window.gZenThemePicker);
                });
            }
            if (retryCount++ > 20) clearInterval(interval);
        }, 500);
    },

    startModules(picker) {
        this.log("Starting modules...");

        // 1. Unlock Total Dot Limit to 6
        try {
            if (window.nsZenThemePicker) {
                window.nsZenThemePicker.MAX_DOTS = 6;
            }
            if (picker.constructor) {
                picker.constructor.MAX_DOTS = 6;
            }
        } catch (e) {
            this.error("Failed to set MAX_DOTS", e);
        }

        // 2. Initialize Modules
        for (const module of this.modules) {
            try {
                module.init(picker);
            } catch (e) {
                this.error(`Failed start: ${module.constructor.name}`, e);
            }
        }
    },

    /**
     * Storage - Per-Workspace Preference storage in about:config
     */
    Storage: {
        PREFIX: "zen.theme.rotation.",

        _getKey(uuid) {
            if (!uuid) return null;
            const san = uuid.toString().replace(/[{}]/g, "").replace(/[^a-zA-Z0-9.-]/g, "_");
            return this.PREFIX + san;
        },

        getRotation(uuid) {
            const key = this._getKey(uuid);
            if (!key) return undefined;
            try {
                if (Services.prefs.prefHasUserValue(key)) {
                    const val = Services.prefs.getCharPref(key);
                    const num = parseInt(val, 10);
                    if (!isNaN(num)) return num;
                }
            } catch (e) { }
            return undefined;
        },

        setRotation(uuid, angle) {
            const key = this._getKey(uuid);
            if (!key) return;
            const val = Math.round(angle).toString();
            try {
                Services.prefs.setCharPref(key, val);
            } catch (e) { }
        }
    },

    log(msg, ...args) {
        // Silenced for production-like feel
    },

    error(msg, ...args) {
        console.error(`[Zen Picker Mods] ERROR: ${msg}`, ...args);
    }
};

/**
 * OpacityModule - Unlocks 0-1 opacity range
 */
class OpacityModule {
    static PATHS = {
        LINE: "M 51.373 27.395 L 367.037 27.395",
        SINE: "M 51.373 27.395 C 60.14 -8.503 68.906 -8.503 77.671 27.395 C 86.438 63.293 95.205 63.293 103.971 27.395 C 112.738 -8.503 121.504 -8.503 130.271 27.395 C 139.037 63.293 147.803 63.293 156.57 27.395 C 165.335 -8.503 174.101 -8.503 182.868 27.395 C 191.634 63.293 200.4 63.293 209.167 27.395 C 217.933 -8.503 226.7 -8.503 235.467 27.395 C 244.233 63.293 252.999 63.293 261.765 27.395 C 270.531 -8.503 279.297 -8.503 288.064 27.395 C 296.83 63.293 305.596 63.293 314.363 27.395 M 314.438 27.395 C 323.204 -8.503 331.97 -8.503 340.737 27.395 C 349.503 63.293 358.27 63.293 367.037 27.395"
    };
    static REFERENCE_Y = 27.395;

    constructor() {
        this.sinePoints = this._parseAndOptimizePath(OpacityModule.PATHS.SINE);
        this.rafId = null;
        this.lastOpacity = -1;
        this.lastCSSState = null;
        this.elements = {};
    }

    init(picker) {
        this.refreshElements();
        this.patchPicker(picker);
        this.setupUI(picker);
        this.scheduleVisualUpdate(picker.currentOpacity);
    }

    refreshElements() {
        this.elements = {
            slider: document.getElementById("PanelUI-zen-gradient-generator-opacity"),
            path: document.querySelector("#PanelUI-zen-gradient-slider-wave svg path"),
            stops: document.querySelectorAll("#PanelUI-zen-gradient-generator-slider-wave-gradient stop"),
            root: document.documentElement
        };
    }

    setupUI(picker) {
        const { slider } = this.elements;
        if (slider) {
            slider.min = "0";
            slider.max = "1";
            slider.step = "0.001";
            slider.addEventListener("input", (e) => this.scheduleVisualUpdate(parseFloat(e.target.value)));
            slider.value = picker.currentOpacity;
        }
    }

    patchPicker(picker) {
        const origOnWorkspaceChange = picker.onWorkspaceChange.bind(picker);
        picker.blendWithWhiteOverlay = (c, o) => `rgba(${c[0]},${c[1]},${c[2]},${o})`;
        picker.onWorkspaceChange = (ws, skip, theme) => {
            origOnWorkspaceChange(ws, skip, theme);
            this.refreshElements();
            if (this.elements.slider) {
                this.lastOpacity = picker.currentOpacity;
                this.performVisualUpdate(this.lastOpacity);
            }
        };
    }

    scheduleVisualUpdate(opacity) {
        if (Math.abs(opacity - this.lastOpacity) < 0.0001) return;
        this.lastOpacity = opacity;
        if (this.rafId) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this.performVisualUpdate(this.lastOpacity);
        });
    }

    performVisualUpdate(opacity) {
        this.toggleTransparentCSS(opacity <= 0.001);
        if (!this.elements.slider || !this.elements.slider.isConnected) {
            this.refreshElements();
            if (!this.elements.slider) return;
        }

        this.elements.slider.value = opacity;
        this.elements.slider.style.setProperty("--zen-thumb-height", `${40 + opacity * 15}px`);
        this.elements.slider.style.setProperty("--zen-thumb-width", `${10 + opacity * 15}px`);

        if (this.elements.stops?.length >= 3) {
            const pct = Math.min(opacity * 100 + 3, 100) + "%";
            this.elements.stops[1].setAttribute("offset", pct);
            this.elements.stops[2].setAttribute("offset", pct);
        }

        if (this.elements.path) {
            if (opacity <= 0.001) {
                this.elements.path.setAttribute("d", OpacityModule.PATHS.LINE);
                this.elements.path.style.stroke = this.elements.stops?.[2]?.getAttribute("stop-color") || "currentColor";
            } else if (opacity >= 0.999) {
                this.elements.path.setAttribute("d", OpacityModule.PATHS.SINE);
                this.elements.path.style.stroke = "url(#PanelUI-zen-gradient-generator-slider-wave-gradient)";
            } else {
                this.elements.path.setAttribute("d", this._interpolate(opacity));
                this.elements.path.style.stroke = "url(#PanelUI-zen-gradient-generator-slider-wave-gradient)";
            }
        }
    }

    toggleTransparentCSS(isTransparent) {
        const root = this.elements.root || document.documentElement;
        const BG = "--zen-main-browser-background";
        const TB = "--zen-main-browser-background-toolbar";
        const state = isTransparent ? "transparent" : "opaque";
        if (this.lastCSSState === state) return;
        this.lastCSSState = state;
        if (isTransparent) {
            if (root) {
                root.style.setProperty(BG, "transparent", "important");
                root.style.setProperty(TB, "transparent", "important");
            }
        } else if (root && root.style.getPropertyValue(BG) === "transparent") {
            root.style.removeProperty(BG);
            root.style.removeProperty(TB);
        }
    }

    _parseAndOptimizePath(path) {
        const points = [];
        const cmds = path.match(/[MCL]\s*[\d\s.\-,]+/g) || [];
        for (const cmd of cmds) {
            const t = cmd[0], n = cmd.slice(1).trim().split(/[\s,]+/).map(Number);
            if (t === "M") points.push({ t, x: n[0], dy: n[1] - OpacityModule.REFERENCE_Y });
            else if (t === "L") points.push({ t, x: n[0], y: n[1] });
            else for (let i = 0; i < n.length; i += 6) points.push({ t: "C", x1: n[i], dy1: n[i + 1] - OpacityModule.REFERENCE_Y, x2: n[i + 2], dy2: n[i + 3] - OpacityModule.REFERENCE_Y, x: n[i + 4], dy: n[i + 5] - OpacityModule.REFERENCE_Y });
        }
        return points;
    }

    _interpolate(t) {
        let d = "";
        for (const p of this.sinePoints) {
            if (p.t === "M") d += `M ${p.x} ${OpacityModule.REFERENCE_Y + p.dy * t} `;
            else if (p.t === "C") d += `C ${p.x1} ${OpacityModule.REFERENCE_Y + p.dy1 * t} ${p.x2} ${OpacityModule.REFERENCE_Y + p.dy2 * t} ${p.x} ${OpacityModule.REFERENCE_Y + p.dy * t} `;
            else d += `L ${p.x} ${p.y} `;
        }
        return d.trim();
    }
}

/**
 * HarmonyModule - Unique Types for High-Count Harmonies
 */
class HarmonyModule {
    init(picker) {
        if (picker._harmonyModPatched) return;
        picker.constructor.MAX_DOTS = 6;
        this.injectCSS();
        this.patchHarmonies(picker);
        this.patchLogic(picker);
        picker._harmonyModPatched = true;
    }

    injectCSS() {
        let style = document.getElementById("zen-picker-mods-harmony-css");
        if (!style) {
            style = document.createElement("style");
            style.id = "zen-picker-mods-harmony-css";
            document.head.appendChild(style);
        }
        style.textContent = `
            #PanelUI-zen-gradient-generator[zen-harmony-mode="floating"] .zen-theme-picker-dot:not(:first-of-type) {
                pointer-events: all !important;
                cursor: pointer !important;
            }
            #PanelUI-zen-gradient-generator[zen-harmony-mode="floating"] .zen-theme-picker-dot:not(:first-of-type):not([dragging="true"]):hover {
                transform: scale(1.05) translate(-50%, -50%) !important;
                z-index: 2000 !important;
                box-shadow: 0 0 10px var(--zen-colors-text-primary), 0 0 4px rgba(0,0,0,0.1) !important;
                transition: transform 0.2s !important;
            }
            @keyframes zen-dot-angular-wiggle {
                0%, 100% { transform: translate(-50%, -50%) rotate(0deg); }
                20% { transform: translate(-50%, -50%) rotate(8deg); }
                40% { transform: translate(-50%, -50%) rotate(-6deg); }
                60% { transform: translate(-50%, -50%) rotate(3deg); }
                80% { transform: translate(-50%, -50%) rotate(-1.5deg); }
            }
            #PanelUI-zen-gradient-generator .zen-theme-picker-dot.zen-dot-shake {
                transform-origin: calc(50% + var(--ox, 0px)) calc(50% + var(--oy, 0px)) !important;
                animation: zen-dot-angular-wiggle 0.6s cubic-bezier(0.4, 0, 0.2, 1) both !important;
                z-index: 2001 !important;
            }

        `;


    }

    patchHarmonies(picker) {
        const harmonies = [
            { type: "complementary", angles: [180] },
            { type: "singleAnalogous", angles: [330] },
            { type: "splitComplementary", angles: [150, 210] },
            { type: "triadic", angles: [120, 240] },
            { type: "analogous", angles: [30, 330] },
            { type: "polygonal4", angles: [90, 180, 270] },
            { type: "analogousLinear4", angles: [30, 330, 0] },
            { type: "floating", angles: [0, 0, 0] },

            { type: "polygonal5", angles: [72, 144, 216, 288] },
            { type: "analogous5", angles: [30, 60, 300, 330] },
            { type: "hybridAnalogous5", angles: [30, 330, 20, 340] },
            { type: "floating", angles: [0, 0, 0, 0] },

            { type: "polygonal6", angles: [60, 120, 180, 240, 300] },
            { type: "doubleAnalogous6", angles: [30, 330, 20, 340, 0] },
            { type: "floating", angles: [0, 0, 0, 0, 0] },

            { type: "linear", angles: [0] },
            { type: "linear", angles: [0, 0] },
            { type: "floating", angles: [] },
            { type: "floating", angles: [0] },
            { type: "floating", angles: [0, 0] }
        ];

        Object.defineProperty(picker, "colorHarmonies", {
            get: () => harmonies,
            configurable: true
        });
    }

    patchLogic(picker) {
        const origCalculate = picker.calculateCompliments.bind(picker);
        const origHandle = picker.handleColorPositions.bind(picker);

        // 1. Cleanup Orphans - Fixes "Dead Dots" by ensuring state and UI never diverge
        picker.handleColorPositions = function (colorPositions, ignoreLegacy = false) {
            const targetIDs = new Set(colorPositions.map(p => p.ID));

            // Immediately purge any dots that the harmony calculation decided should not exist
            this.dots = this.dots.filter(dot => {
                if (!targetIDs.has(dot.ID)) {
                    dot.element?.remove();
                    return false;
                }
                return true;
            });

            // Call original handle logic for movement/color updates
            return origHandle(colorPositions, ignoreLegacy);
        };

        // 2. Count-Aware Calculation - Fixes "Mode Jumping" and "5-dot jump"
        picker.calculateCompliments = function (dots, action = "update", useHarmony = "") {
            const currentAlgo = useHarmony || this.useAlgo || "";
            const harmonies = this.colorHarmonies;

            // Robust Count Logic: dots.length is already reduced for "remove" in native calls
            const totalTargetDots = dots.length + (action === "add" ? 1 : 0);
            const targetAnglesCount = Math.max(0, totalTargetDots - 1);

            // Direct Default Lookup during Transitions (Zen Default Behavior)
            if (action === "add" || action === "remove") {
                const nextHarmony = harmonies.find(h => h.angles.length === targetAnglesCount);

                if (nextHarmony && (nextHarmony.type === "floating" || nextHarmony.type === "linear")) {
                    this.useAlgo = nextHarmony.type;
                    const rect = this.panel.querySelector(".zen-theme-picker-gradient").getBoundingClientRect();
                    const center = { x: rect.width / 2, y: rect.height / 2 };
                    const primary = dots.find(d => d.ID === 0) || dots[0];

                    let updatedDots = [...dots];
                    if (action === "add") {
                        updatedDots.push({ ID: dots.length, position: center, type: (primary?.type || "explicit-lightness") });
                    }
                    return updatedDots;
                }

                // For standard harmonies, let the original logic handle the default snap by passing ""
                return origCalculate(dots, action, "");
            }

            const activeAlgo = useHarmony || this.useAlgo || "";
            const isFloating = (activeAlgo === "floating");
            const isLinear = (activeAlgo === "linear");
            const isHybrid4 = (activeAlgo === "analogousLinear4");
            const isHybrid5 = (activeAlgo === "hybridAnalogous5");
            const isHybrid6 = (activeAlgo === "doubleAnalogous6");

            if (isFloating) {
                this.panel.setAttribute("zen-harmony-mode", "floating");
                this.useAlgo = "floating";
                if ((action === "harmony" || (action === "update" && useHarmony === "floating" && !this._floatingActive)) && !this.dragging) {
                    this._floatingActive = true;
                    setTimeout(() => {
                        const rect = this.panel.querySelector(".zen-theme-picker-gradient").getBoundingClientRect();
                        const cx = rect.width / 2, cy = rect.height / 2;
                        dots.forEach(dot => {
                            const el = dot.element;
                            if (el) {
                                const ox = cx - dot.position.x, oy = cy - dot.position.y;
                                el.style.setProperty("--ox", ox + "px");
                                el.style.setProperty("--oy", oy + "px");
                                el.classList.remove("zen-dot-shake");
                                void el.offsetWidth;
                                el.classList.add("zen-dot-shake");
                                setTimeout(() => el.classList.remove("zen-dot-shake"), 650);
                            }
                        });
                    }, 50);
                }
                return dots;
            }
            this._floatingActive = false;
            this.panel.removeAttribute("zen-harmony-mode");

            if (isHybrid4 || isHybrid5 || isHybrid6) {
                this.useAlgo = activeAlgo;
                const rect = this.panel.querySelector(".zen-theme-picker-gradient").getBoundingClientRect();
                const center = { x: rect.width / 2, y: rect.height / 2 }, maxRadius = rect.width / 2;
                const primary = dots.find(d => d.ID === 0) || dots[0];
                const dx = primary.position.x - center.x, dy = primary.position.y - center.y;
                const baseAngle = Math.atan2(dy, dx), primaryRadius = Math.sqrt(dx * dx + dy * dy);
                const factor = primaryRadius < (maxRadius * 0.3) ? 1 : (primaryRadius > (maxRadius * 0.5) ? 0 : 1 - ((primaryRadius - maxRadius * 0.3) / (maxRadius * 0.2)));
                const secondaryRadius = (primaryRadius / 2) * (1 - factor) + (primaryRadius + (maxRadius - primaryRadius) / 2) * factor;
                const secondary = dots.filter(d => d.ID !== 0).sort((a, b) => a.ID - b.ID);

                const hybridConfigs = {
                    "analogousLinear4": { angles: [30, -30, 0], radii: [primaryRadius, primaryRadius, secondaryRadius], min: 4 },
                    "hybridAnalogous5": { angles: [30, -30, 20, -20], radii: [primaryRadius, primaryRadius, secondaryRadius, secondaryRadius], min: 5 },
                    "doubleAnalogous6": { angles: [30, -30, 20, -20, 0], radii: [primaryRadius, primaryRadius, secondaryRadius, secondaryRadius, secondaryRadius], min: 6 }
                };

                const config = hybridConfigs[activeAlgo];
                if (config && dots.length >= config.min) {
                    return dots.map(dot => {
                        if (dot.ID === 0) return dot;
                        const idx = secondary.indexOf(dot);
                        if (idx < 0 || idx >= config.angles.length) return dot;
                        const angle = baseAngle + (config.angles[idx] * Math.PI / 180), r = config.radii[idx];
                        return { ...dot, position: { x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) } };
                    });
                }
            }

            if (isLinear && dots.length >= 2 && dots.length <= 6) {
                this.useAlgo = "linear";
                const rect = this.panel.querySelector(".zen-theme-picker-gradient").getBoundingClientRect();
                const center = { x: rect.width / 2, y: rect.height / 2 }, maxRadius = rect.width / 2;
                const primary = dots.find(d => d.ID === 0) || dots[0];
                const dx = primary.position.x - center.x, dy = primary.position.y - center.y;
                const primaryAngle = Math.atan2(dy, dx), primaryRadius = Math.sqrt(dx * dx + dy * dy);
                const factor = primaryRadius < (maxRadius * 0.3) ? 1 : (primaryRadius > (maxRadius * 0.5) ? 0 : 1 - ((primaryRadius - maxRadius * 0.3) / (maxRadius * 0.2)));
                const secondary = dots.filter(d => d.ID !== 0).sort((a, b) => a.ID - b.ID);
                const count = secondary.length;

                return dots.map(dot => {
                    if (dot.ID === 0) return dot;
                    const index = secondary.indexOf(dot);
                    if (index < 0) return dot;
                    const targetRadius = (primaryRadius / (count + 1) * (index + 1)) * (1 - factor) +
                        (primaryRadius + ((maxRadius - primaryRadius) / (count + 1) * (index + 1))) * factor;
                    return { ...dot, position: { x: center.x + targetRadius * Math.cos(primaryAngle), y: center.y + targetRadius * Math.sin(primaryAngle) } };
                });
            }

            if (action === "remove" && dots.length >= 3) {
                const result = origCalculate(dots, action, activeAlgo);
                return result.slice(0, dots.length);
            }

            return origCalculate(dots, action, activeAlgo);
        };
    }
}

/**
 * RotationModule - Custom Gradient Rotation Control
 * Forced isolation per workspace via about:config
 */
class RotationModule {
    static DEFAULT_ROTATION = -45;

    constructor() {
        this.currentRotation = RotationModule.DEFAULT_ROTATION;
        this.dialWrapper = null;
        this.dialHandler = null;
        this.dialLabel = null;
        this.dialRing = null;
        this.dialArc = null;
        this.picker = null;
        this._isDragging = false;
        this._boundMouseMove = null;
        this._boundMouseUp = null;
        this._ignoreNextThemeUpdate = false;
        this._hadRecentDrag = false;
    }

    get displayAngle() {
        let offset = this.currentRotation - RotationModule.DEFAULT_ROTATION;
        offset = ((offset % 360) + 360) % 360;
        return Math.round(offset);
    }

    init(picker) {
        if (picker._rotationModPatched) return;
        this.picker = picker;
        picker._rotationModule = this;

        this.injectCSS();
        this.injectDial();
        this.patchGradient(picker);
        this.patchWorkspaceChange(picker);
        this.patchInitThemePicker(picker);
        this.patchPanelOpen(picker);
        picker._rotationModPatched = true;

        // Apply saved rotation to the initial workspace on startup
        setTimeout(() => {
            if (this.dialWrapper) {
                this.restoreRotation();
                this._ignoreNextThemeUpdate = true;
                try {
                    if (this.picker.updateCurrentWorkspace) this.picker.updateCurrentWorkspace();
                } finally {
                    this._ignoreNextThemeUpdate = false;
                }
            }
        }, 150);
    }

    injectCSS() {
        let style = document.getElementById("zen-picker-mods-rotation-css");
        if (!style) {
            style = document.createElement("style");
            style.id = "zen-picker-mods-rotation-css";
            document.head.appendChild(style);
        }
        style.textContent = `
            #zen-rotation-dial-wrapper { width: 5rem; height: 5rem; position: relative; overflow: visible; display: flex !important; align-items: center; justify-content: center; border-radius: 50%; }
            @media (-moz-platform: macos) { #zen-rotation-dial-wrapper { width: 6rem; height: 6rem; } }
            #zen-rotation-dial-wrapper::after { content: ""; position: absolute; width: 60%; height: 60%; border: 1px solid color-mix(in srgb, var(--zen-colors-border) 50%, transparent 50%); border-radius: 50%; background: linear-gradient(-45deg, transparent -10%, light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.1)) 110%); z-index: 2; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; }
            #zen-rotation-dial-wrapper:not([disabled]):hover::after { pointer-events: all; cursor: pointer; }
            
            #zen-rotation-dial-ring { position: absolute; width: 100%; height: 100%; top: 0; left: 0; pointer-events: none; z-index: 1; overflow: visible !important; }
            #zen-rotation-dial-arc { position: absolute; width: 100%; height: 100%; top: 0; left: 0; pointer-events: none; z-index: 2; overflow: visible !important; transform: rotate(-90deg); transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
            
            #zen-rotation-dial-label { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 11px; font-weight: 600; color: light-dark(rgba(0,0,0,0.6), rgba(255,255,255,0.7)); z-index: 3; pointer-events: none; user-select: none; transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1); display: flex; align-items: center; justify-content: center; }
            #zen-rotation-dial-label span { opacity: 0.6; transition: opacity 0.15s ease-out; }
            #zen-rotation-dial-label::after { content: ""; position: absolute; width: 14px; height: 14px; background: currentColor; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 2v6h-6'%3E%3C/path%3E%3Cpath d='M3 12a9 9 0 0 1 15-6.7L21 8'%3E%3C/path%3E%3Cpath d='M3 22v-6h6'%3E%3C/path%3E%3Cpath d='M21 12a9 9 0 0 1-15 6.7L3 16'%3E%3C/path%3E%3C/svg%3E") no-repeat center; mask-size: contain; opacity: 0; transform: translate(0, -1px); transition: opacity 0.2s ease-out; }
            #zen-rotation-dial-wrapper.knob-hover #zen-rotation-dial-label span { opacity: 0; }
            #zen-rotation-dial-wrapper.knob-hover #zen-rotation-dial-label::after { opacity: 0.6; }

            #zen-rotation-dial-handler-container { position: absolute; width: 100%; height: 100%; top: 0; left: 0; pointer-events: none; z-index: 10 !important; }
            #zen-rotation-dial-handler-container.zen-programmatic-change { transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
            #zen-rotation-dial-handler { width: 6px; height: 12px; background: light-dark(#757575, #d1d1d1); position: absolute; top: 0; left: 50%; transform: translate(-50%, -50%); border-radius: 2px; cursor: pointer; pointer-events: all !important; transition: height 0.1s; }
            #zen-rotation-dial-wrapper[disabled] { opacity: 0.4; pointer-events: none !important; }
            #zen-rotation-dial-wrapper[disabled] #zen-rotation-dial-handler { pointer-events: none !important; cursor: default; }
            #zen-rotation-dial-handler:hover { height: 14px; }

            /* Grain Reset UI */
            #PanelUI-zen-gradient-generator-texture-wrapper { position: relative; cursor: default; }
            #PanelUI-zen-gradient-generator-texture-wrapper.knob-hover { cursor: pointer; }
            #zen-grain-reset-label { 
                position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                font-size: 10px; font-weight: 600; color: light-dark(rgba(0,0,0,0.6), rgba(255,255,255,0.7)); 
                z-index: 5; pointer-events: none; user-select: none; opacity: 1; transition: opacity 0.2s;
                width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
            }
            #zen-grain-reset-label::after { 
                content: ""; position: absolute; width: 14px; height: 14px; 
                background: currentColor; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 2v6h-6'%3E%3C/path%3E%3Cpath d='M3 12a9 9 0 0 1 15-6.7L21 8'%3E%3C/path%3E%3Cpath d='M3 22v-6h6'%3E%3C/path%3E%3Cpath d='M21 12a9 9 0 0 1-15 6.7L3 16'%3E%3C/path%3E%3C/svg%3E") no-repeat center; 
                mask-size: contain; opacity: 0; transition: opacity 0.2s;
            }
            #PanelUI-zen-gradient-generator-texture-wrapper.knob-hover #zen-grain-reset-label::after { opacity: 0.6; }
            #zen-grain-reset-label span { display: none !important; }
        `;
    }

    injectDial() {
        const textureWrapper = document.getElementById("PanelUI-zen-gradient-generator-texture-wrapper");
        if (!textureWrapper) return;

        const wrapper = document.createElement("div");
        wrapper.id = "zen-rotation-dial-wrapper";

        const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        ring.id = "zen-rotation-dial-ring";
        ring.setAttribute("viewBox", "0 0 100 100");
        ring.innerHTML = `<circle cx="50" cy="50" r="50" fill="none" stroke="light-dark(rgba(0, 0, 0, 0.3), rgba(255, 255, 255, 0.3))" stroke-width="4" stroke-linecap="round" opacity="0.4" />`;
        wrapper.appendChild(ring);
        this.dialRing = ring;

        const arc = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        arc.id = "zen-rotation-dial-arc";
        arc.setAttribute("viewBox", "0 0 100 100");
        arc.innerHTML = `<circle cx="50" cy="50" r="50" fill="none" stroke="var(--zen-colors-text-primary, white)" stroke-width="4" stroke-linecap="round" stroke-dasharray="0 315" opacity="0.25" />`;
        wrapper.appendChild(arc);
        this.dialArc = arc;

        const label = document.createElement("div");
        label.id = "zen-rotation-dial-label";
        const labelText = document.createElement("span");
        labelText.textContent = "0°";
        label.appendChild(labelText);
        wrapper.appendChild(label);
        this.dialLabel = label;
        this._dialLabelSpan = labelText;

        const container = document.createElement("div");
        container.id = "zen-rotation-dial-handler-container";
        const handler = document.createElement("div");
        handler.id = "zen-rotation-dial-handler";
        container.appendChild(handler);
        wrapper.appendChild(container);
        this.dialHandler = container;
        this._dialHandleEl = handler;

        // Create or get secondary row for our custom controls
        let secondaryRow = document.getElementById("zen-picker-secondary-row");
        if (!secondaryRow) {
            const nativeRow = document.getElementById("PanelUI-zen-gradient-colors-wrapper");
            if (!nativeRow) return;

            secondaryRow = document.createElement("hbox");
            secondaryRow.id = "zen-picker-secondary-row";
            nativeRow.parentNode.insertBefore(secondaryRow, nativeRow.nextSibling);
        }

        // Create wrapper for rotation dial (right side of secondary row)
        const rotationWrapper = document.createElement("vbox");
        rotationWrapper.id = "zen-picker-rotation-wrapper";
        // User requested 20px left shift
        rotationWrapper.style.marginRight = "20px";
        rotationWrapper.appendChild(wrapper);

        secondaryRow.appendChild(rotationWrapper);
        this.dialWrapper = wrapper;

        this._boundMouseMove = this.onDialMouseMove.bind(this);
        this._boundMouseUp = this.onDialMouseUp.bind(this);
        this._dialHandleEl.addEventListener("mousedown", this.onDialMouseDown.bind(this));

        wrapper.addEventListener("click", (e) => {
            if (this._hadRecentDrag) {
                this._hadRecentDrag = false;
                return;
            }
            if (e.target.id === "zen-rotation-dial-wrapper" || e.target.closest("#zen-rotation-dial-wrapper")) {
                const rect = wrapper.getBoundingClientRect();
                const dx = e.clientX - (rect.left + rect.width / 2);
                const dy = e.clientY - (rect.top + rect.height / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < (rect.width * 0.32) && !wrapper.hasAttribute("disabled")) {
                    if (this.currentRotation !== RotationModule.DEFAULT_ROTATION) {
                        if (this.dialHandler) {
                            this.dialHandler.classList.add("zen-programmatic-change");
                            setTimeout(() => this.dialHandler?.classList.remove("zen-programmatic-change"), 500);
                        }
                        this.currentRotation = RotationModule.DEFAULT_ROTATION;
                        this.updateUI();
                        this.applyRotation();
                    }
                }
            }
        });

        // Knob hover detection for reload icon
        wrapper.addEventListener("mousemove", (e) => {
            if (wrapper.hasAttribute("disabled") || this._isDragging) return;

            const rect = wrapper.getBoundingClientRect();
            const dx = e.clientX - (rect.left + rect.width / 2);
            const dy = e.clientY - (rect.top + rect.height / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < (rect.width * 0.32)) wrapper.classList.add("knob-hover");
            else wrapper.classList.remove("knob-hover");
        });
        wrapper.addEventListener("mouseleave", () => wrapper.classList.remove("knob-hover"));

        setTimeout(() => this.updateUI(), 0);
    }

    updateUI() {
        const dots = this.picker?.dots || [];
        const dotCount = dots.length;
        const isDisabled = (dotCount <= 1);


        if (this.dialWrapper) {
            if (isDisabled) this.dialWrapper.setAttribute("disabled", "true");
            else this.dialWrapper.removeAttribute("disabled");
        }

        if (!this.dialLabel) return;

        const opacity = isDisabled ? "0" : "1";
        this.dialLabel.style.opacity = opacity;
        if (this.dialArc) this.dialArc.style.opacity = opacity;

        if (this.dialHandler) {
            const angle = isDisabled ? 0 : this.displayAngle;
            this.dialHandler.style.transform = `rotate(${angle}deg)`;
        }

        if (!isDisabled && this._dialLabelSpan) {
            this._dialLabelSpan.textContent = `${this.displayAngle}°`;
        }

        if (this.dialArc) {
            const circle = this.dialArc.querySelector("circle");
            if (isDisabled) circle.setAttribute("opacity", "0");
            else {
                circle.setAttribute("opacity", "0.25");
                circle.style.transition = "";
                if (this.dialHandler?.classList.contains("zen-programmatic-change")) {
                    circle.style.transition = "stroke-dasharray 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
                }
                const circumference = 314.159;
                const arcLength = (this.displayAngle / 360) * circumference;
                circle.setAttribute("stroke-dasharray", `${arcLength} ${circumference}`);
            }
        }
    }

    onDialMouseDown(event) {
        if (this.dialWrapper?.hasAttribute("disabled")) return;
        this._isDragging = true;
        this._hadRecentDrag = false;
        if (this.dialHandler) this.dialHandler.classList.add("dragging");
        document.addEventListener("mousemove", this._boundMouseMove);
        document.addEventListener("mouseup", this._boundMouseUp);
    }

    onDialMouseMove(event) {
        if (!this._isDragging || !this.dialWrapper) return;
        this._hadRecentDrag = true;
        const rect = this.dialWrapper.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
        let mouseAngle = (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI + 90;
        mouseAngle = ((Math.round(mouseAngle) % 360) + 360) % 360;
        const newRotation = mouseAngle + RotationModule.DEFAULT_ROTATION;
        let norm = newRotation;
        while (norm > 180) norm -= 360;
        while (norm <= -180) norm += 360;

        if (this.currentRotation !== norm) {
            this.currentRotation = norm;
            this.updateUI();
            this._ignoreNextThemeUpdate = true;
            try {
                // BUG FIX: passing true here suppresses the "deep refresh" (preference change logic) 
                // which was causing the infinite dot flickering during rotation.
                this.picker.updateCurrentWorkspace(true);
            } finally {
                this._ignoreNextThemeUpdate = false;
            }
        }
    }

    onDialMouseUp(event) {
        if (!this._isDragging) return;
        this._isDragging = false;
        if (this.dialHandler) this.dialHandler.classList.remove("dragging");
        document.removeEventListener("mousemove", this._boundMouseMove);
        document.removeEventListener("mouseup", this._boundMouseUp);
        this.applyRotation();
        setTimeout(() => { this._hadRecentDrag = false; }, 200);
    }

    get activeWorkspace() {
        if (this.picker?._currentWorkspace) return this.picker._currentWorkspace;
        if (window.gZenWorkspaces?.getActiveWorkspace) return window.gZenWorkspaces.getActiveWorkspace();
        return null;
    }

    applyRotation() {
        if (!this.picker) return;
        const ws = this.activeWorkspace;
        const uuid = ws?.uuid || ws?.id;
        if (uuid) {
            ZenPickerMods.Storage.setRotation(uuid, this.currentRotation);
            if (ws.theme) ws.theme.rotation = this.currentRotation;
        }
        this._ignoreNextThemeUpdate = true;
        try {
            // Only update visuals, don't trigger full refresh
            if (this.picker.updateCurrentWorkspace) this.picker.updateCurrentWorkspace(false);
        } finally {
            this._ignoreNextThemeUpdate = false;
        }
    }

    restoreRotation(ws) {
        if (this._isDragging) return;
        if (this.dialHandler) {
            this.dialHandler.classList.add("zen-programmatic-change");
            setTimeout(() => this.dialHandler?.classList.remove("zen-programmatic-change"), 500);
        }
        const target = ws || this.activeWorkspace;
        const uuid = target?.uuid || target?.id;
        if (!uuid) return;
        const stored = ZenPickerMods.Storage.getRotation(uuid);
        if (stored !== undefined && !isNaN(stored)) {
            this.currentRotation = stored;
            if (target.theme) target.theme.rotation = stored;
        } else {
            this.currentRotation = RotationModule.DEFAULT_ROTATION;
            if (target.theme) target.theme.rotation = RotationModule.DEFAULT_ROTATION;
        }
        this.updateUI();
    }

    patchPanelOpen(picker) {
        const panel = document.getElementById("PanelUI-zen-gradient-generator");
        if (panel) {
            panel.addEventListener("popupshowing", () => this.restoreRotation());
            panel.addEventListener("popupshown", () => {
                this._ignoreNextThemeUpdate = true;
                const ws = this.activeWorkspace;
                if (ws?.theme) ws.theme.rotation = this.currentRotation;
                // Avoid full updateCurrentWorkspace call which triggers redundant refreshes
                this._ignoreNextThemeUpdate = false;
            });
        }
    }

    patchInitThemePicker(picker) {
        const self = this;
        const orig = picker.initThemePicker?.bind(picker);
        if (orig) {
            picker.initThemePicker = function (...args) {
                self.restoreRotation();
                const res = orig(...args);
                self.updateUI();
                return res;
            };
        }
    }

    patchWorkspaceChange(picker) {
        const self = this;
        const origOnWorkspace = picker.onWorkspaceChange.bind(picker);
        picker.onWorkspaceChange = function (ws, skip, theme) {
            if (!self._ignoreNextThemeUpdate) self.restoreRotation(ws);
            origOnWorkspace(ws, skip, theme);
            self.updateUI();
        };

        const origUpdate = picker.updateCurrentWorkspace.bind(picker);
        picker.updateCurrentWorkspace = function (...args) {
            const ws = self.activeWorkspace;
            if (ws?.theme) ws.theme.rotation = self.currentRotation;
            const res = origUpdate.apply(this, args);
            if (!self._ignoreNextThemeUpdate && ws) {
                const uuid = ws.uuid || ws.id;
                if (uuid) ZenPickerMods.Storage.setRotation(uuid, self.currentRotation);
            }
            return res;
        };
    }

    patchGradient(picker) {
        const self = this;
        const orig = picker.getGradient.bind(picker);

        picker.getGradient = function (colors, forToolbar = false) {
            // 1. Force native state restoration (lightness/algorithm) by calling original function
            const nativeResult = orig(colors, forToolbar);

            const themedColors = this.themedColors(colors);
            // 2. Synchronize algorithm state
            const themeAlgo = (themedColors.length > 1) ? (themedColors[0]?.algorithm ?? "") : "";
            if (themeAlgo) this.useAlgo = themeAlgo;

            const uuid = this._currentWorkspace?.uuid;
            let rotation = self.currentRotation;
            const stored = ZenPickerMods.Storage.getRotation(uuid);
            if (stored !== undefined) rotation = stored;

            // 3. If only 1 dot, native result is sufficient
            if (themedColors.length <= 1) return nativeResult;

            const displayDelta = self.displayAngle;
            const getCol = (c) => this.getSingleRGBColor(c, forToolbar);
            const cols = themedColors.map(getCol);

            if (themedColors.find(c => c.isCustom)) {
                const stops = cols.map((c, i) => `${c} ${(i / (cols.length - 1)) * 100}%`).join(", ");
                return `linear-gradient(${RotationModule.DEFAULT_ROTATION + displayDelta}deg, ${stops})`;
            }

            const rad = (displayDelta * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
            const rot = (x, y) => {
                const nx = cos * (x - 50) - sin * (y - 50) + 50;
                const ny = sin * (x - 50) + cos * (y - 50) + 50;
                return `${Math.round(nx)}% ${Math.round(ny)}%`;
            };

            // 2 Dots
            if (cols.length === 2) {
                const angle = -45 + displayDelta;
                if (!forToolbar) return [`linear-gradient(${angle}deg, ${cols[1]} 0%, transparent 100%)`, `linear-gradient(${angle + 180}deg, ${cols[0]} 0%, transparent 100%)`].reverse().join(", ");
                return `linear-gradient(${angle}deg, ${cols[1]} 0%, ${cols[0]} 100%)`;
            }

            // 3 Dots (Pure Native)
            const baseAngle = -5 + displayDelta;
            if (cols.length === 3) {
                return [
                    `linear-gradient(${baseAngle}deg, ${cols[2]} 10%, transparent 80%)`,
                    `radial-gradient(circle at ${rot(95, 0)}, ${cols[1]} 0%, transparent 75%)`,
                    `radial-gradient(circle at ${rot(0, 0)}, ${cols[0]} 10%, transparent 70%)`
                ].join(", ");
            }

            // 4+ Dots Special Polish
            const layers = [];
            const r60 = "60%";

            // 1. TOP LAYERS: Radial glows that must be distinct (Bottom segments)
            if (cols.length === 4) {
                layers.push(`radial-gradient(circle at ${rot(0, 100)}, ${cols[2]} 0%, transparent ${r60})`); // BL (Dot 3)
            } else if (cols.length === 5) {
                layers.push(`radial-gradient(circle at ${rot(0, 100)}, ${cols[2]} 0%, transparent ${r60})`); // BL (Dot 3)
                layers.push(`radial-gradient(circle at ${rot(100, 100)}, ${cols[3]} 0%, transparent ${r60})`); // BR (Dot 4)
            } else if (cols.length === 6) {
                layers.push(`radial-gradient(circle at ${rot(0, 100)}, ${cols[2]} 0%, transparent ${r60})`); // BL (Dot 3)
                layers.push(`radial-gradient(circle at ${rot(100, 100)}, ${cols[4]} 0%, transparent ${r60})`); // BR (Dot 5)
                layers.push(`radial-gradient(circle at ${rot(50, 100)}, ${cols[3]} 0%, transparent 65%)`);    // BC (Dot 4)
            }

            // 2. MIDDLE LAYER: The Linear Background wash
            layers.push(`linear-gradient(${baseAngle}deg, ${cols[cols.length - 1]} 10%, transparent 80%)`);

            // 3. UNDER LAYERS: Primary top glows (shine through linear transparency)
            layers.push(`radial-gradient(circle at ${rot(95, 0)}, ${cols[1]} 0%, transparent ${r60})`); // TR (Dot 2)
            layers.push(`radial-gradient(circle at ${rot(0, 0)}, ${cols[0]} 10%, transparent ${r60})`);  // TL (Dot 1)

            return layers.join(", ");
        };
    }
}

/**
 * PaletteModule - Cycles between 5 palette behaviors
 */
class PaletteModule {
    static MODES = [
        { id: "full", label: "Full", type: undefined, lightness: 50 },
        { id: "pastel", label: "Pastel", type: "explicit-lightness", lightness: 85 },
        { id: "vibrant", label: "Vibrant", type: "explicit-lightness", lightness: 50 },
        { id: "dark", label: "Dark", type: "explicit-lightness", lightness: 25 },
        { id: "deep-dark", label: "Deep Dark", type: "explicit-lightness", lightness: 15 },
        { id: "bw", label: "B&W", type: "explicit-black-white", lightness: 50 }
    ];

    constructor() {
        this._isAnimating = false;
    }

    init(picker) {
        if (picker._paletteModPatched) return;
        this.picker = picker;
        this._selectedMode = null; // Forces mode when set
        this.injectUI();
        this.injectSlider();
        this.patchPicker(picker);
        picker._paletteModPatched = true;
    }

    injectUI() {
        const actions = document.getElementById("PanelUI-zen-gradient-generator-color-actions");
        if (!actions || document.getElementById("zen-picker-palette-cycle")) return;

        const btn = document.createElement("button");
        btn.id = "zen-picker-palette-cycle";
        btn.className = "subviewbutton";

        btn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: translate(-1px, -1px);">
 <path d="M2 12C2 17.5228 6.47715 22 12 22C13.6569 22 15 20.6569 15 19V18.5C15 18.0356 15 17.8034 15.0257 17.6084C15.2029 16.2622 16.2622 15.2029 17.6084 15.0257C17.8034 15 18.0356 15 18.5 15H19C20.6569 15 22 13.6569 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M7 13C7.55228 13 8 12.5523 8 12C8 11.4477 7.55228 11 7 11C6.44772 11 6 11.4477 6 12C6 12.5523 6.44772 13 7 13Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M16 9C16.5523 9 17 8.55228 17 8C17 7.44772 16.5523 7 16 7C15.4477 7 15 7.44772 15 8C15 8.55228 15.4477 9 16 9Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M10 8C10.5523 8 11 7.55228 11 7C11 6.44772 10.5523 6 10 6C9.44772 6 9 6.44772 9 7C9 7.55228 9.44772 8 10 8Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 </svg>`;

        ["mousedown", "click", "mouseup", "command"].forEach(type => {
            btn.addEventListener(type, (e) => {
                e.stopPropagation();
                if (type === "click" || type === "command") {
                    e.preventDefault();
                    if (!btn.disabled) this.cyclePalette();
                }
            }, true);
        });

        const heart = document.getElementById("zen-picker-favorite-save");
        if (heart) actions.insertBefore(btn, heart);
        else actions.appendChild(btn);

        let style = document.getElementById("zen-picker-mods-palette-css");
        if (!style) {
            style = document.createElement("style");
            style.id = "zen-picker-mods-palette-css";
            document.head.appendChild(style);
        }
        style.textContent = `
            #zen-picker-palette-cycle {
                display: flex !important;
                align-items: center;
                justify-content: center;
                list-style-image: none !important;
            }
            #zen-picker-lightness-wrapper {
                position: relative;
                flex: 1;
                height: 40px;
                display: flex;
                align-items: center;
            }
            #zen-picker-lightness-slider {
                flex: 1;
                margin: 0 !important;
                background: transparent;
                z-index: 5;
                padding: 0 5px;
                transition: opacity 0.1s;
                opacity: 0.1;
            }
            #zen-picker-lightness-slider.zen-programmatic-change::-moz-range-thumb {
                transition: none !important;
            }
            #zen-picker-lightness-slider[disabled="true"] {
                pointer-events: none;
            }
            #zen-picker-lightness-slider[disabled="true"]::-moz-range-thumb {
                display: none !important;
            }
            #zen-picker-lightness-slider:focus,
            #zen-picker-lightness-slider:active,
            #zen-picker-lightness-slider:not([disabled]):hover {
                opacity: 1;
            }
            #zen-picker-lightness-slider::-moz-range-thumb {
                background: light-dark(black, white);
                border-radius: 999px;
                height: var(--zen-thumb-height, 40px);
                width: var(--zen-thumb-width, 10px);
                cursor: pointer;
                border: none;
                transition: height 0.2s ease-out, width 0.2s ease-out;
            }
            #zen-picker-lightness-wrapper.zen-programmatic-change #zen-picker-lightness-slider::-moz-range-thumb {
                /* Thumb position is handled by browser, but we can animate size */
                transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #zen-picker-lightness-slider::-moz-range-track {
                border-radius: 999px;
                height: 18px; /* Match native track */
                background: transparent;
            }
            #zen-picker-lightness-slider::-moz-range-progress {
                background: transparent;
            }
            #zen-picker-lightness-slider[disabled] {
                pointer-events: none;
            }
            #zen-picker-lightness-slider[disabled]::-moz-range-thumb {
                visibility: hidden;
            }
            /* SVG line styling - EXACT MATCH to native opacity slider */
            #zen-picker-lightness-wave {
                position: absolute;
                left: -5px;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 1;
                display: flex;
                align-items: center;
                justify-content: flex-start;
            }
            #zen-picker-lightness-wave::before {
                content: "";
                position: absolute;
                width: calc(100% - 8px);
                height: 16px;
                background: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.1));
                border-radius: 999px;
                pointer-events: none;
                z-index: -1;
                top: 50%;
                left: 8px;
                transform: translateY(-50%);
            }
            #zen-picker-lightness-wave svg {
                overflow: visible;
                min-width: calc(100% * 1.1);
                scale: 1.2;
                margin-left: 4px;
            }
            #zen-picker-lightness-path {
                stroke-width: 8px;
                transition: stroke 0.2s ease-out;
            }
            #zen-picker-lightness-wrapper[disabled="true"] #zen-picker-lightness-path {
                stroke: light-dark(rgba(77, 77, 77, 0.5), rgba(161, 161, 161, 0.5)) !important;
            }
            /* Secondary Row - matches native #PanelUI-zen-gradient-colors-wrapper */
            #zen-picker-secondary-row {
                display: flex;
                justify-content: space-between;
                width: 100%;
                margin-bottom: 10px;
                align-items: center;
                gap: 1.5rem;
                padding: 0 var(--panel-padding, 10px);
            }
            /* Rotation wrapper in secondary row - match native layout */
            #zen-picker-rotation-wrapper {
                display: flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 auto;
                position: relative;
                z-index: 20;
                transition: opacity 0.2s;
            }
            /* Controls layout */
            #PanelUI-zen-gradient-generator-controls {
                flex-direction: column !important;
                align-items: stretch !important;    
                display: flex !important;
            }
        `;
        this.updateUI();
    }

    patchPicker(picker) {
        const self = this;
        // Capture original for forceNativeLightness
        this.origGetColor = picker.getColorFromPosition.bind(picker);

        // 1. Authoritative Update & Sync
        const origUpdate = picker.updateCurrentWorkspace.bind(picker);
        picker.updateCurrentWorkspace = function (skipSave = true) {
            // A. Detect workspace change and reset palette override
            const currentWsId = gZenWorkspaces?.activeWorkspace?.uuid;
            const isWsChange = currentWsId && self._lastWorkspaceId && currentWsId !== self._lastWorkspaceId;
            if (isWsChange) {
                self._selectedMode = null;
            }

            // B. Default back to Full if no dots (User request)
            if (this.dots.length === 0 && self._selectedMode) {
                self._selectedMode = null;
            }

            // C. Capture the native logic's result first (sets up the base state)
            const res = origUpdate.apply(this, [skipSave]);

            // D. Refresh our own tool UI (Heart/Palette icons)
            // Trigger animation if: Workspace changed OR Lightness changed substantially OR manual save
            const newL = this.dots[0]?.lightness ?? 50;
            const lightnessChanged = Math.abs((self._lastSyncedLightness ?? 50) - newL) > 0.5;
            const rotationInProg = picker._rotationModule?._isDragging;

            // If lightness changed from an external source (preset/favorite), reset our override mode
            // We ignore changes triggered by our own palette cycle via _internalUpdate
            if (lightnessChanged && !rotationInProg && !self._internalUpdate) {
                self._selectedMode = null;
            }

            self.updateUI((!skipSave && !rotationInProg) || isWsChange || (lightnessChanged && !rotationInProg));

            self._lastWorkspaceId = currentWsId;
            self._lastSyncedLightness = newL;
            if (this._favoritesMod) this._favoritesMod.updateButtonState();

            return res;
        };

        // 2. Authoritative Position Color: Force mode during drags
        const origGetColor = picker.getColorFromPosition.bind(picker);
        picker.getColorFromPosition = function (x, y, type) {
            if (self._selectedMode) {
                type = self._selectedMode.type;
            }
            return origGetColor(x, y, type);
        };

        // 3. Authoritative Background: Force mode during background generation
        const origGetGradient = picker.getGradient.bind(picker);
        picker.getGradient = function (colors, forToolbar = false) {
            if (self._selectedMode && colors.length > 0) {
                const mode = self._selectedMode;
                const currentAlgo = this.useAlgo || "";
                colors.forEach(c => {
                    c.type = mode.type;
                    if (mode.lightness !== undefined) c.lightness = mode.lightness;
                    // Force re-assertion of harmony (Use private storage if possible, or just set c.algorithm)
                    if (currentAlgo) {
                        c.algorithm = currentAlgo;
                        // Avoid setting this.useAlgo here to prevent infinite recursion loop
                    }
                });
            }
            return origGetGradient(colors, forToolbar);
        };

        // 4. Release override if user clicks a native preset box
        document.getElementById("PanelUI-zen-gradient-generator-color-pages")
            ?.addEventListener("click", (e) => {
                if (e.target.tagName.toLowerCase() === "box") {
                    self._selectedMode = null;
                    self.updateUI();
                }
            }, true);
    }

    forceNativeLightness(lightness) {
        if (!this.origGetColor || !this.picker.panel) return;

        try {
            const panel = this.picker.panel.querySelector(".zen-theme-picker-gradient");
            if (!panel) return;

            const rect = panel.getBoundingClientRect();
            // Constants matched to Zen's native logic
            const padding = 30;
            const width = rect.width + padding * 2;
            const height = rect.height + padding * 2;
            const radius = (width - padding) / 2;
            const centerX = width / 2;
            const centerY = height / 2;

            // Corrected Formula: Lightness = (dist / radius) * 100
            // Distance = (Lightness / 100) * radius
            const dist = radius * (lightness / 100);

            // Calculate x, y relative to center, then adjust for dotHalfSize(29)
            const x = centerX + dist - 29;
            const y = centerY - 29;

            // Call original to trigger side-effect update of #currentLightness
            this.origGetColor(x, y, "force-update");
        } catch (e) { console.error("Force Lightness Error", e); }
    }

    getCurrentModeIndex() {
        if (this._selectedMode) {
            return PaletteModule.MODES.findIndex(m => m.id === this._selectedMode.id);
        }

        const firstDot = this.picker.dots[0];
        if (!firstDot) return 0;

        const type = firstDot.type;
        const lightness = firstDot.lightness;

        if (type === "explicit-black-white") return 5;
        if (type === "explicit-lightness") {
            if (lightness >= 80) return 1; // Pastel
            if (lightness <= 20) return 4; // Deep Dark
            if (lightness <= 45) return 3; // Dark
            return 2; // Vibrant
        }
        return 0; // Full
    }

    cyclePalette() {
        const currentIdx = this.getCurrentModeIndex();
        const nextIdx = (currentIdx + 1) % PaletteModule.MODES.length;
        this.applyMode(PaletteModule.MODES[nextIdx]);
    }

    applyMode(mode) {
        this._selectedMode = mode;
        if (this.picker.dots.length) {
            this._internalUpdate = true;
            try {
                // Correctly update local dots array avoid stale reads in updateUI/hooks
                this.picker.dots.forEach(d => {
                    if (mode.lightness !== undefined) d.lightness = mode.lightness;
                    d.type = mode.type;
                });

                if (mode.lightness !== undefined) {
                    this.forceNativeLightness(mode.lightness);
                }

                const positions = this.picker.dots.map(d => ({
                    ID: d.ID,
                    position: d.position,
                    type: mode.type
                }));

                this.picker.handleColorPositions(positions, true);
                this.picker.updateCurrentWorkspace(false);
            } finally {
                this._internalUpdate = false;
            }
        }
        this.updateUI(true);
    }

    updateUI(animate = false, skipSaveOnSync = false) {
        const btn = document.getElementById("zen-picker-palette-cycle");
        if (!btn) return;

        const dotCount = this.picker.dots?.length || 0;
        btn.disabled = dotCount === 0;

        const mode = PaletteModule.MODES[this.getCurrentModeIndex()];
        btn.setAttribute("tooltiptext", `Palette: ${mode.label}${this._selectedMode ? " (Forced)" : ""}`);

        // Sync Lightness Slider
        const slider = document.getElementById("zen-picker-lightness-slider");
        const sliderWrapper = document.getElementById("zen-picker-lightness-wrapper");

        if (slider) {
            // Disable slider if: No Dots OR Full Mode OR B&W Mode
            const isExplicit = mode.type === "explicit-lightness";
            const isDisabled = dotCount === 0 || !isExplicit;

            slider.disabled = isDisabled;
            // Native opacity slider disabled style handling
            sliderWrapper?.setAttribute("disabled", isDisabled);
            slider.style.opacity = "1"; // Keep visible as requested

            // Only update slider value if we are in an explicit mode
            if (isExplicit) {
                // Restoration Fix: Priority = Theme > Dot > 50
                const currentL = this._selectedMode?.lightness ??
                    this.picker.currentWorkspace?.theme?.lightness ??
                    this.picker.dots[0]?.lightness ?? 50;

                if (animate && slider && !this._isAnimating) {
                    sliderWrapper?.classList.add("zen-programmatic-change");
                    this.animateSliderValue(slider, currentL);
                    setTimeout(() => sliderWrapper?.classList.remove("zen-programmatic-change"), 500);
                } else if (!this._isAnimating) {
                    slider.value = currentL;
                    slider.setAttribute("tooltiptext", `Lightness: ${Math.round(currentL)}%`);
                    this.updateLightnessVisuals(currentL);
                }
            } else {
                // Update wave visual state even when disabled (e.g. 0% for B&W)
                const l = (mode.type === "explicit-black-white") ? 0 : 50;
                this.updateLightnessVisuals(l);
            }
        }
    }

    // Helper to parse SVG path commands for interpolation
    parseSinePath(pathStr) {
        const points = [];
        const commands = pathStr.match(/[MCL]\s*[\d\s.\-,]+/g);
        if (!commands) return points;

        commands.forEach((command) => {
            const type = command.charAt(0);
            const coordsStr = command.slice(1).trim();
            const coords = coordsStr.split(/[\s,]+/).map(Number);

            switch (type) {
                case "M":
                    points.push({ x: coords[0], y: coords[1], type: "M" });
                    break;
                case "C":
                    if (coords.length >= 6 && coords.length % 6 === 0) {
                        for (let i = 0; i < coords.length; i += 6) {
                            points.push({
                                x1: coords[i],
                                y1: coords[i + 1],
                                x2: coords[i + 2],
                                y2: coords[i + 3],
                                x: coords[i + 4],
                                y: coords[i + 5],
                                type: "C",
                            });
                        }
                    }
                    break;
                case "L":
                    points.push({ x: coords[0], y: coords[1], type: "L" });
                    break;
            }
        });
        return points;
    }

    interpolateWavePath(progress) {
        // Native Zen paths (Exact match: 367.037 length)
        const linePath = `M 51.373 27.395 L 367.037 27.395`;
        const sinePath = `M 51.373 27.395 C 60.14 -8.503 68.906 -8.503 77.671 27.395 C 86.438 63.293 95.205 63.293 103.971 27.395 C 112.738 -8.503 121.504 -8.503 130.271 27.395 C 139.037 63.293 147.803 63.293 156.57 27.395 C 165.335 -8.503 174.101 -8.503 182.868 27.395 C 191.634 63.293 200.4 63.293 209.167 27.395 C 217.933 -8.503 226.7 -8.503 235.467 27.395 C 244.233 63.293 252.999 63.293 261.765 27.395 C 270.531 -8.503 279.297 -8.503 288.064 27.395 C 296.83 63.293 305.596 63.293 314.363 27.395 C 323.13 -8.503 331.896 -8.503 340.662 27.395 M 314.438 27.395 C 323.204 -8.503 331.97 -8.503 340.737 27.395 C 349.503 63.293 358.27 63.293 367.037 27.395`;

        if (!this._sinePoints) {
            this._sinePoints = this.parseSinePath(sinePath);
        }

        if (progress <= 0.001) return linePath;
        if (progress >= 0.999) return sinePath;

        const referenceY = 27.395;
        const t = progress;
        let newPathData = "";

        this._sinePoints.forEach((p) => {
            switch (p.type) {
                case "M": {
                    const interpolatedY = referenceY + (p.y - referenceY) * t;
                    newPathData += `M ${p.x} ${interpolatedY} `;
                    break;
                }
                case "C": {
                    const y1 = referenceY + (p.y1 - referenceY) * t;
                    const y2 = referenceY + (p.y2 - referenceY) * t;
                    const y = referenceY + (p.y - referenceY) * t;
                    newPathData += `C ${p.x1} ${y1} ${p.x2} ${y2} ${p.x} ${y} `;
                    break;
                }
                case "L":
                    newPathData += `L ${p.x} ${p.y} `;
                    break;
            }
        });
        return newPathData;
    }

    injectSlider() {
        if (document.getElementById("zen-picker-lightness-wrapper")) return;

        // Create or get secondary row for our custom controls
        let secondaryRow = document.getElementById("zen-picker-secondary-row");
        if (!secondaryRow) {
            const nativeRow = document.getElementById("PanelUI-zen-gradient-colors-wrapper");
            if (!nativeRow) return;

            secondaryRow = document.createElement("hbox");
            secondaryRow.id = "zen-picker-secondary-row";
            nativeRow.parentNode.insertBefore(secondaryRow, nativeRow.nextSibling);
        }

        // Create our new Lightness Slider Wrapper (left side of secondary row)
        const sliderContainer = document.createElement("vbox");
        sliderContainer.id = "zen-picker-lightness-wrapper";
        sliderContainer.setAttribute("flex", "1");
        sliderContainer.setAttribute("align", "stretch");

        // 1. The Wave Box
        const waveBox = document.createElement("hbox");
        waveBox.id = "zen-picker-lightness-wave";
        waveBox.setAttribute("flex", "1");
        waveBox.style.pointerEvents = "none";

        // Unique IDs for gradient to prevent conflicts
        const gradientId = "zen-picker-lightness-generator-gradient";
        const stop1Id = "zen-picker-lightness-stop-1";
        const stop2Id = "zen-picker-lightness-stop-2";
        const stop3Id = "zen-picker-lightness-stop-3";

        waveBox.innerHTML = `
            <svg viewBox="0 -7.605 455 70" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop id="${stop1Id}" offset="0%" stop-color="light-dark(rgb(90, 90, 90), rgb(161, 161, 161))"/>
                    <stop id="${stop2Id}" offset="0%" stop-color="light-dark(rgb(90, 90, 90), rgb(161, 161, 161))"/>
                    <stop id="${stop3Id}" offset="100%" stop-color="light-dark(rgba(77, 77, 77, 0.5), rgba(161, 161, 161, 0.5))"/>
                  </linearGradient>
                </defs>
                <path id="zen-picker-lightness-path" 
                      d="M 51.373 27.395 L 367.037 27.395" 
                      fill="none" 
                      stroke-linecap="round" 
                      stroke-linejoin="round" 
                      style="stroke-width: 8px; stroke: light-dark(rgba(77, 77, 77, 0.5), rgba(161, 161, 161, 0.5));"/>
            </svg>
        `;

        // 2. The Input
        const slider = document.createElement("input");
        slider.type = "range";
        slider.id = "zen-picker-lightness-slider";
        slider.min = "5";
        slider.max = "95";
        slider.step = "any"; // Fixes bounce/snapping during JS animations
        slider.value = "50";
        slider.setAttribute("flex", "1");

        let lastRun = 0;
        const limit = 50;

        // Initial update
        this.updateLightnessVisuals(50); // Start at mid

        // High performance local update while dragging
        slider.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value); // Use parseFloat for "any" step
            e.target.setAttribute("tooltiptext", `Lightness: ${Math.round(val)}%`);
            this.updateLightnessVisuals(val);

            const modeIdx = this.getCurrentModeIndex();
            let baseMode = PaletteModule.MODES[modeIdx];
            if (!baseMode || (baseMode.type !== "explicit-lightness" && baseMode.type !== "explicit-black-white")) {
                baseMode = PaletteModule.MODES.find(m => m.id === "vibrant");
            }

            // Update current forced state object
            this._selectedMode = { ...baseMode, lightness: val };

            // 1. PROJECT: Direct Dot & Background projection (Fast)
            if (this.picker.dots.length) {
                // Access via main controller or direct instance if possible.
                // Since this listener is inside PaletteModule, we can call directly.
                // But fastProjectLightness is on ZenPickerMods (this.picker is unrelated there?)
                // Wait, fastProjectLightness is defined in PaletteModule?
                // Let's check the context of 'this' in fastProjectLightness usage.

                // NO, fastProjectLightness is defined in PaletteModule in the file view!
                // Let me verify the class structure.
                // Line 943: class PaletteModule
                // Line 1604: fastProjectLightness(lightness) { ... }
                // So fastProjectLightness is a method of PaletteModule.

                this._internalUpdate = true;
                try {
                    this.fastProjectLightness(val);
                } finally {
                    this._internalUpdate = false;
                }
            }
        });

        // Heavy Sync only on release (change)
        slider.addEventListener("change", (e) => {
            const val = parseFloat(e.target.value);
            this._internalUpdate = true; // Prevent mode reset during sync
            try {
                this.forceNativeLightness(val);

                const positions = this.picker.dots.map(d => ({
                    ID: d.ID,
                    position: d.position,
                    type: mode.type
                }));
                this.picker.handleColorPositions(positions, true);
                this.picker.updateCurrentWorkspace(false);
            } finally {
                this._internalUpdate = false;
            }
            this.updateUI(false, true);
        });

        sliderContainer.appendChild(waveBox);
        sliderContainer.appendChild(slider);

        // Prepend to secondary row (left side)
        secondaryRow.insertBefore(sliderContainer, secondaryRow.firstChild);
    }
    animateSliderValue(slider, target) {
        if (this._isAnimating) {
            if (this._rafId) cancelAnimationFrame(this._rafId);
            this._isAnimating = false;
        }
        const start = parseFloat(slider.value);
        if (Math.abs(start - target) < 0.5) { // Threshold to prevent animation for tiny changes
            slider.value = target;
            this.updateLightnessVisuals(target);
            slider.setAttribute("tooltiptext", `Lightness: ${Math.round(target)}%`);
            return;
        }

        this._isAnimating = true;
        let startTimestamp = null;
        const duration = 400;

        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            // Ease out cubic
            const ease = 1 - Math.pow(1 - progress, 3);
            const current = start + (target - start) * ease;

            slider.classList.add("zen-programmatic-change");
            slider.value = current;
            this.updateLightnessVisuals(current);
            // RESIZE DURING SLIDE: Update thumb size in the loop
            const opacity = (current - 5) / 90;
            slider.style.setProperty("--zen-thumb-height", `${40 + opacity * 15}px`);
            slider.style.setProperty("--zen-thumb-width", `${10 + opacity * 15}px`);

            if (progress < 1) {
                this._rafId = requestAnimationFrame(step);
            } else {
                slider.value = target; // Final snap to target
                this.updateLightnessVisuals(target);
                this._isAnimating = false;
                this._rafId = null;
                slider.classList.remove("zen-programmatic-change");
                slider.setAttribute("tooltiptext", `Lightness: ${Math.round(target)}%`);
                // Final sized sync
                const finalOpacity = (target - 5) / 90;
                slider.style.setProperty("--zen-thumb-height", `${40 + finalOpacity * 15}px`);
                slider.style.setProperty("--zen-thumb-width", `${10 + finalOpacity * 15}px`);
            }
        };
        requestAnimationFrame(step);
    }

    updateLightnessVisuals(val) {
        if (this._lastVisualVal === val) return;
        this._lastVisualVal = val;

        const slider = document.getElementById("zen-picker-lightness-slider");
        if (!slider) return;

        // Normalized 0-1
        const opacity = (val - 5) / 90;

        const svgPath = document.getElementById("zen-picker-lightness-path");
        const gradientId = "zen-picker-lightness-generator-gradient";

        if (svgPath) {
            const d = this.interpolateWavePath(opacity);
            svgPath.setAttribute("d", d);

            // Native stop syncing
            // Native dual-stop syncing for progress fill
            const stop2 = document.getElementById("zen-picker-lightness-stop-2");
            const stop3 = document.getElementById("zen-picker-lightness-stop-3");
            const fillPct = `${Math.max(0, Math.min(100, opacity * 100))}%`;
            if (stop2) stop2.setAttribute("offset", fillPct);
            if (stop3) stop3.setAttribute("offset", fillPct);

            if (opacity <= 0.01) {
                svgPath.style.stroke = stop3?.getAttribute("stop-color") || "light-dark(rgba(77, 77, 77, 0.5), rgba(161, 161, 161, 0.5))";
            } else {
                svgPath.style.stroke = `url(#${gradientId})`;
            }

            // Sync overall wave opacity with slider state
            const wave = document.getElementById("zen-picker-lightness-wave");
            if (wave) {
                // User requested track and base of sine wave to remain same opacity
                // We only hide fill and thumb via CSS if [disabled="true"]
                wave.style.opacity = "1";
            }
        }

        // Thumb size
        const h = 40 + opacity * 15;
        const w = 10 + opacity * 15;
        slider.style.setProperty("--zen-thumb-height", `${h}px`);
        slider.style.setProperty("--zen-thumb-width", `${w}px`);
    }

    /**
     * Fast Projector: Directly updates dot colors and background CSS
     * without triggering heavy native reconciliation.
     */
    fastProjectLightness(lightness) {
        const picker = this.picker;
        const docElem = document.documentElement;
        const panel = picker.panel.querySelector(".zen-theme-picker-gradient");

        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        const padding = 30;
        const dotHalfSize = 29;
        const width = rect.width + padding * 2;
        const height = rect.height + padding * 2;
        const cx = width / 2, cy = height / 2;
        const radius = (width - padding) / 2;

        // 0. Sync Private State (Lightweight)
        if (this.paletteMod) {
            this.paletteMod.forceNativeLightness(lightness);
        }

        // 1. Update Dot Visuals (Calculate Hue & Saturation from Position)
        const updatedColors = picker.dots.map(dot => {
            const x = dot.position.x + dotHalfSize;
            const y = dot.position.y + dotHalfSize;
            const dx = x - cx;
            const dy = y - cy;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const normalizedDistance = 1 - Math.min(distance / radius, 1);

            const h = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
            // Exact parity with Zen's getColorFromPosition
            let s = normalizedDistance * 100;
            if (dot.type && dot.type !== "explicit-lightness") {
                s = 90 + (1 - normalizedDistance) * 10;
            }
            if (dot.type === "explicit-black-white") s = 0;

            dot.lightness = lightness;
            const rgb = picker.hslToRgb(h / 360, s / 100, lightness / 100);
            const colorStr = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

            dot.element.style.setProperty("--zen-theme-picker-dot-color", colorStr);
            return { ...dot, c: rgb, type: dot.type, lightness };
        });

        // 2. Update Background Visuals
        const gradient = picker.getGradient(updatedColors);
        const toolbarGradient = picker.getGradient(updatedColors, true);

        docElem.style.setProperty("--zen-main-browser-background", gradient);
        docElem.style.setProperty("--zen-main-browser-background-toolbar", toolbarGradient);

        // 3. Update Primary/Accent UI Color
        const dominant = picker.getMostDominantColor(updatedColors);
        if (dominant) {
            const primary = picker.getAccentColorForUI(dominant);
            docElem.style.setProperty("--zen-primary-color", primary);

            // 4. Update Text Contrast (Text Color)
            try {
                const isDarkMode = picker.shouldBeDarkMode(dominant);
                docElem.setAttribute("zen-should-be-dark-mode", isDarkMode);

                const textColor = picker.getToolbarColor(isDarkMode);
                docElem.style.setProperty(
                    "--toolbox-textcolor",
                    `rgba(${textColor[0]}, ${textColor[1]}, ${textColor[2]}, ${textColor[3]})`
                );
            } catch (e) { /* ignore contrast errors during drag */ }
        }

        // 4. Persistence Fix: Update native theme object to prevent reset during dot dragging
        const ws = picker.currentWorkspace;
        if (ws?.theme) {
            ws.theme.lightness = lightness;
        }
    }
}

/**
 * FavoritesModule - Global Theme Presets
 */
class FavoritesModule {
    static PREF = "zen.theme.picker.favorites";

    init(picker) {
        if (picker._favoritesModPatched) return;
        this.picker = picker;
        this.injectUI();
        this.patchLogic(picker);
        picker._favoritesModPatched = true;
    }

    injectUI() {
        const actions = document.getElementById("PanelUI-zen-gradient-generator-color-actions");
        if (!actions || document.getElementById("zen-picker-favorite-save")) return;

        const btn = document.createElement("button");
        btn.id = "zen-picker-favorite-save";
        btn.className = "subviewbutton";
        btn.setAttribute("tooltiptext", "Toggle Favorite");

        // Prevent palette from stealing focus/clicks and dot-snapping
        ["mousedown", "click", "mouseup", "command"].forEach(type => {
            btn.addEventListener(type, (e) => {
                e.stopPropagation();
                if (type === "click" || type === "command") {
                    e.preventDefault();
                    this.toggleFavorite();
                }
            }, true);
        });

        actions.appendChild(btn);

        let style = document.getElementById("zen-picker-mods-favorites-css");
        if (!style) {
            style = document.createElement("style");
            style.id = "zen-picker-mods-favorites-css";
            document.head.appendChild(style);
        }
        style.textContent = `
            #zen-picker-favorite-save {
                display: flex !important;
                align-items: center;
                justify-content: center;
                list-style-image: none !important;
                opacity: 1;
            }
            #zen-picker-favorite-save[disabled] {
                opacity: 0.3 !important;
                pointer-events: none !important;
            }
            #PanelUI-zen-gradient-generator-scheme {
                opacity: 0.6 !important;
            }
            #zen-picker-favorite-save::before {
                content: "";
                width: 18px;
                height: 18px;
                background: currentColor;
                mask: url("data:image/svg+xml,%3Csvg width='100%25' height='100%25' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M11.9932 5.13581C9.9938 2.7984 6.65975 2.16964 4.15469 4.31001C1.64964 6.45038 1.29697 10.029 3.2642 12.5604C4.89982 14.6651 9.84977 19.1041 11.4721 20.5408C11.6536 20.7016 11.7444 20.7819 11.8502 20.8135C11.9426 20.8411 12.0437 20.8411 12.1361 20.8135C12.2419 20.7819 12.3327 20.7016 12.5142 20.5408C14.1365 19.1041 19.0865 14.6651 20.7221 12.5604C22.6893 10.029 22.3797 6.42787 19.8316 4.31001C17.2835 2.19216 13.9925 2.7984 11.9932 5.13581Z' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center;
                mask-size: contain;
            }
            #zen-picker-favorite-save:hover::before {
                opacity: 0.8;
            }
            #zen-picker-favorite-save.is-favorite::before {
                background: #f44336 !important;
                mask: url("data:image/svg+xml,%3Csvg width='100%25' height='100%25' viewBox='0 0 24 24' fill='black' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11.9932 5.13581C9.9938 2.7984 6.65975 2.16964 4.15469 4.31001C1.64964 6.45038 1.29697 10.029 3.2642 12.5604C4.89982 14.6651 9.84977 19.1041 11.4721 20.5408C11.6536 20.7016 11.7444 20.7819 11.8502 20.8135C11.9426 20.8411 12.0437 20.8411 12.1361 20.8135C12.2419 20.7819 12.3327 20.7016 12.5142 20.5408C14.1365 19.1041 19.0865 14.6651 20.7221 12.5604C22.6893 10.029 22.3797 6.42787 19.8316 4.31001C17.2835 2.19216 13.9925 2.7984 11.9932 5.13581Z'/%3E%3C/svg%3E") no-repeat center;
            }
            
            /* Favorites Pages & Grid */
            .zen-picker-favorites-page {
                justify-content: space-between;
                min-width: 100%;
                padding: 0 1px;
            }
            .zen-picker-favorite-box {
                width: 26px;
                height: 26px;
                box-shadow: 0 0 1px 1px rgba(0, 0, 0, 0.1);
                border-radius: 50%;
                cursor: pointer;
                position: relative;
                transition: transform 0.1s;
                overflow: visible !important;
            }
            .zen-picker-favorite-box:hover {
                transform: scale(1.05);
            }
            .zen-picker-favorite-box:active {
                transform: scale(0.95);
            }
            .zen-picker-favorite-box:after {
                content: "";
                position: absolute;
                bottom: -2px;
                right: -2px;
                width: 12px;
                height: 12px;
                background: #f44336;
                mask: url("data:image/svg+xml,%3Csvg width='100%25' height='100%25' viewBox='0 0 24 24' fill='black' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11.9932 5.13581C9.9938 2.7984 6.65975 2.16964 4.15469 4.31001C1.64964 6.45038 1.29697 10.029 3.2642 12.5604C4.89982 14.6651 9.84977 19.1041 11.4721 20.5408C11.6536 20.7016 11.7444 20.7819 11.8502 20.8135C11.9426 20.8411 12.0437 20.8411 12.1361 20.8135C12.2419 20.7819 12.3327 20.7016 12.5142 20.5408C14.1365 19.1041 19.0865 14.6651 20.7221 12.5604C22.6893 10.029 22.3797 6.42787 19.8316 4.31001C17.2835 2.19216 13.9925 2.7984 11.9932 5.13581Z'/%3E%3C/svg%3E") no-repeat center;
                mask-size: contain;
                pointer-events: none;
                filter: drop-shadow(0 0 1px white);
                z-index: 2;
            }
            .zen-picker-favorite-box[data-num-dots="2"] {
                background: linear-gradient(135deg, var(--c1), var(--c2)) !important;
            }
            .zen-picker-favorite-box[data-num-dots="3"] {
                background: radial-gradient(circle at 0% 0%, var(--c1), transparent 100%), 
                            radial-gradient(circle at 100% 0%, var(--c2), transparent 100%),
                            linear-gradient(to top, var(--c3) 0%, transparent 60%) !important;
            }
            .zen-picker-favorite-box[data-num-dots="4"] {
                background: radial-gradient(circle at 0% 0%, var(--c1), transparent 70%),
                            radial-gradient(circle at 100% 0%, var(--c2), transparent 70%),
                            radial-gradient(circle at 0% 100%, var(--c3), transparent 70%),
                            linear-gradient(-45deg, var(--c4) 0%, transparent 100%) !important;
            }
            .zen-picker-favorite-box[data-num-dots="5"] {
                background: radial-gradient(circle at 0% 0%, var(--c1), transparent 60%),
                            radial-gradient(circle at 100% 0%, var(--c2), transparent 60%),
                            radial-gradient(circle at 0% 100%, var(--c3), transparent 60%),
                            radial-gradient(circle at 100% 100%, var(--c4), transparent 60%),
                            linear-gradient(-45deg, var(--c5) 0%, transparent 100%) !important;
            }
            .zen-picker-favorite-box[data-num-dots="6"] {
                background: radial-gradient(circle at 0% 0%, var(--c1), transparent 60%),
                            radial-gradient(circle at 100% 0%, var(--c2), transparent 60%),
                            radial-gradient(circle at 0% 100%, var(--c3), transparent 60%),
                            radial-gradient(circle at 50% 100%, var(--c4), transparent 60%),
                            radial-gradient(circle at 100% 100%, var(--c5), transparent 60%),
                            linear-gradient(-45deg, var(--c6) 0%, transparent 100%) !important;
            }

            .zen-picker-favorite-box.is-ghost {
                background: light-dark(rgba(0,0,0,0.03), rgba(255,255,255,0.05)) !important;
                border: 1px dashed light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.15)) !important;
                box-shadow: none !important;
                pointer-events: none !important;
            }
            .zen-picker-favorite-box.is-ghost::before { display: none !important; }
            .zen-picker-favorite-box.is-ghost:after { display: none !important; }

            /* Heart Transition */
            .zen-picker-favorite-heart {
                transition: fill 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.6s ease;
                opacity: 0.5;
            }
            .zen-picker-favorite-heart[active="true"] {
                fill: #ef4444 !important;
                opacity: 1;
            }
            
            /* Box overlay heart */
            .zen-picker-favorite-box .zen-picker-favorite-heart[active="true"] {
                fill: white !important;
                opacity: 0.9;
            }
            
            /* Favorite Pop-in Animation */
            .zen-favorite-pop-in {
                animation: zen-favorite-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
            }
            @keyframes zen-favorite-pop {
                0% { transform: scale(0.6); opacity: 0; }
                100% { transform: scale(1); opacity: 1; }
            }

            /* Restoration Transitions (Bug 3) */
            #PanelUI-zen-gradient-generator.zen-favorites-restoring #PanelUI-zen-gradient-generator-opacity {
                transition: --zen-thumb-height 0.4s ease, --zen-thumb-width 0.4s ease !important;
            }
            #PanelUI-zen-gradient-generator.zen-favorites-restoring #PanelUI-zen-gradient-slider-wave path {
                transition: d 0.4s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.4s ease !important;
            }
        `;
    }

    _getFavs() {
        try {
            if (Services.prefs.prefHasUserValue(FavoritesModule.PREF)) {
                return JSON.parse(Services.prefs.getCharPref(FavoritesModule.PREF));
            }
        } catch (e) { }
        return [];
    }

    _saveFavs(favs) {
        try {
            Services.prefs.setCharPref(FavoritesModule.PREF, JSON.stringify(favs));
        } catch (e) { }
    }

    _getCurrentState() {
        const picker = this.picker;
        if (!picker.dots?.length) return null;

        return {
            algo: picker.useAlgo || "",
            lightness: picker.dots[0].lightness || 50,
            numDots: picker.dots.length,
            paletteType: picker.dots[0].type, // Preserving undefined allows 'Full Palette' logic
            opacity: picker.currentOpacity,
            texture: picker.currentTexture || 0,
            rotation: picker.dots.length > 1 ? (picker._rotationModule?.currentRotation || -45) : null,
            dots: picker.dots.map(d => ({
                id: d.ID,
                x: Math.round(d.position.x),
                y: Math.round(d.position.y)
            }))
        };
    }

    _isSame(f1, f2) {
        if (!f1 || !f2) return false;
        if (f1.numDots !== f2.numDots || f1.algo !== f2.algo || f1.paletteType !== f2.paletteType) return false;
        if (Math.abs(f1.opacity - f2.opacity) > 0.01) return false;
        if (Math.abs((f1.texture || 0) - (f2.texture || 0)) > 0.01) return false;
        if (f1.numDots > 1 && Math.round(f1.rotation) !== Math.round(f2.rotation)) return false;
        if (Math.round(f1.lightness) != Math.round(f2.lightness)) return false;

        return f1.dots.length === f2.dots.length && f1.dots.every((d, i) =>
            d.x === f2.dots[i].x && d.y === f2.dots[i].y
        );
    }

    toggleFavorite() {
        const current = this._getCurrentState();
        if (!current) return;

        let favs = this._getFavs();
        const existingIndex = favs.findIndex(f => this._isSame(f, current));

        if (existingIndex > -1) {
            // Remove
            favs.splice(existingIndex, 1);
        } else {
            // Add
            current._isNew = true; // Mark for pop-in animation
            favs.unshift(current);
        }

        this._saveFavs(favs);
        this.updateButtonState();
        this.refreshFavoritesUI();
    }

    patchLogic(picker) {
        const self = this;
        const origHandle = picker.handleColorPositions.bind(picker);

        picker.handleColorPositions = function (colorPositions, ignoreLegacy = false) {
            const res = origHandle(colorPositions, ignoreLegacy);
            self.updateButtonState();
            return res;
        };

        const origUpdate = picker.updateCurrentWorkspace.bind(picker);
        picker.updateCurrentWorkspace = function (...args) {
            const res = origUpdate.apply(this, args);
            self.updateButtonState();
            return res;
        };

        const opacitySlider = document.getElementById("PanelUI-zen-gradient-generator-opacity");
        opacitySlider?.addEventListener("input", () => self.updateButtonState());

        const textureWrapper = document.getElementById("PanelUI-zen-gradient-generator-texture-wrapper");
        let _hadRecentTextureDrag = false;
        textureWrapper?.addEventListener("mousedown", () => {
            const onMove = () => { _hadRecentTextureDrag = true; };
            const up = () => {
                setTimeout(() => { _hadRecentTextureDrag = false; }, 200);
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", up);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", up);
        });

        // Grain Reset Logic
        if (textureWrapper && !document.getElementById("zen-grain-reset-label")) {
            const label = document.createElement("div");
            label.id = "zen-grain-reset-label";
            label.innerHTML = "<span>Reset</span>";
            textureWrapper.appendChild(label);

            textureWrapper.addEventListener("mousemove", (e) => {
                const rect = textureWrapper.getBoundingClientRect();
                const dx = e.clientX - (rect.left + rect.width / 2);
                const dy = e.clientY - (rect.top + rect.height / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < (rect.width * 0.32)) textureWrapper.classList.add("knob-hover");
                else textureWrapper.classList.remove("knob-hover");
            });
            textureWrapper.addEventListener("mouseleave", () => textureWrapper.classList.remove("knob-hover"));

            textureWrapper.addEventListener("click", (e) => {
                if (!textureWrapper.classList.contains("knob-hover") || _hadRecentTextureDrag) return;
                this._animateState(picker.currentOpacity, 0);
                self.updateButtonState();
            });
        }

        // Listen for preset clicks too
        document.getElementById("PanelUI-zen-gradient-generator-color-pages")
            ?.addEventListener("click", () => setTimeout(() => self.updateButtonState(), 10), true);

        // Patch Zen's pagination to handle extra pages
        const pagesWrapper = document.getElementById("PanelUI-zen-gradient-generator-color-pages");
        const leftBtn = document.getElementById("PanelUI-zen-gradient-generator-color-page-left");
        const rightBtn = document.getElementById("PanelUI-zen-gradient-generator-color-page-right");

        if (pagesWrapper && leftBtn && rightBtn) {
            // Force a re-init of pagination logic to account for new children length
            const updatePagBtns = () => {
                leftBtn.disabled = pagesWrapper.scrollLeft === 0;
                rightBtn.disabled = pagesWrapper.scrollLeft + pagesWrapper.offsetWidth >= pagesWrapper.scrollWidth - 1;
            };
            pagesWrapper.addEventListener("scroll", updatePagBtns);

            // Patch Buttons to work with ACTUAL child indices
            leftBtn.addEventListener("click", (e) => {
                e.stopImmediatePropagation();
                const pages = pagesWrapper.children;
                const currentPage = Math.round(pagesWrapper.scrollLeft / pagesWrapper.offsetWidth);
                const nextPage = (currentPage - 1 + pages.length) % pages.length;
                pagesWrapper.scrollLeft = nextPage * pagesWrapper.offsetWidth;
                updatePagBtns();
            }, true);

            rightBtn.addEventListener("click", (e) => {
                e.stopImmediatePropagation();
                const pages = pagesWrapper.children;
                const currentPage = Math.round(pagesWrapper.scrollLeft / pagesWrapper.offsetWidth);
                const nextPage = (currentPage + 1) % pages.length;
                pagesWrapper.scrollLeft = nextPage * pagesWrapper.offsetWidth;
                updatePagBtns();
            }, true);

            // Initial Favorites Load
            this.refreshFavoritesUI();
        }

        this.updateButtonState();
    }

    updateButtonState() {
        const btn = document.getElementById("zen-picker-favorite-save");
        if (!btn || !this.picker) return;

        const current = this._getCurrentState();
        if (!current) {
            btn.setAttribute("disabled", "true");
            btn.classList.remove("is-favorite");
            return;
        }

        btn.removeAttribute("disabled");

        const favs = this._getFavs();
        const isFav = favs.some(f => this._isSame(f, current));

        if (isFav) {
            btn.classList.add("is-favorite");
            btn.querySelector(".zen-picker-favorite-heart")?.setAttribute("active", "true");
            btn.setAttribute("tooltiptext", "Remove from Favorites");
        } else {
            btn.classList.remove("is-favorite");
            btn.querySelector(".zen-picker-favorite-heart")?.setAttribute("active", "false");
            btn.setAttribute("tooltiptext", "Save to Favorites");
        }
    }

    _getPreviewColor(x, y, type, lightnessVal) {
        // Safe HSL to RGB without side-effects on picker state
        const padding = 30, dotHalfSize = 29;
        const rect = { width: 380 + padding * 2, height: 380 + padding * 2 };
        const centerX = rect.width / 2, centerY = rect.height / 2;
        const radius = (rect.width - padding) / 2;
        let px = x + dotHalfSize, py = y + dotHalfSize;
        const dist = Math.sqrt((px - centerX) ** 2 + (py - centerY) ** 2);
        let angle = Math.atan2(py - centerY, px - centerX) * 180 / Math.PI;
        if (angle < 0) angle += 360;
        const normDist = 1 - Math.min(dist / radius, 1);
        let h = angle / 360, s, l;

        if (type === "explicit-lightness") {
            s = normDist;
            l = lightnessVal / 100;
        } else {
            // Dynamic lightness based on distance (Vibrant/Dark modes)
            s = 0.9 + (1 - normDist) * 0.1;
            l = 1 - normDist;
        }

        if (type === "explicit-black-white") { s = 0; l = 1 - normDist; }

        const { round } = Math;
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        let rv, gv, bv;
        if (s === 0) rv = gv = bv = l;
        else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            rv = hue2rgb(p, q, h + 1 / 3); gv = hue2rgb(p, q, h); bv = hue2rgb(p, q, h - 1 / 3);
        }
        return `rgb(${round(rv * 255)}, ${round(gv * 255)}, ${round(bv * 255)})`;
    }

    refreshFavoritesUI() {
        const pagesWrapper = document.getElementById("PanelUI-zen-gradient-generator-color-pages");
        if (!pagesWrapper) return;

        // Cleanup old favorite pages
        Array.from(pagesWrapper.querySelectorAll(".zen-picker-favorites-page")).forEach(p => p.remove());

        const favs = this._getFavs();
        if (!favs.length) return;

        const createBox = (fav) => {
            const box = (document.createXULElement ? document.createXULElement("box") : document.createElement("box"));
            if (!fav) {
                box.className = "zen-picker-favorite-box is-ghost";
                box.style.minWidth = "26px";
                box.style.minHeight = "26px";
                return box;
            }
            box.className = "zen-picker-favorite-box";
            box.setAttribute("data-num-dots", fav.numDots);
            const colors = fav.dots.map(d => this._getPreviewColor(d.x, d.y, fav.paletteType, fav.lightness));
            if (fav.numDots === 1) {
                box.style.setProperty("background", colors[0], "important");
            } else {
                colors.forEach((c, idx) => box.style.setProperty(`--c${idx + 1}`, c));
            }
            box.addEventListener("click", (e) => {
                e.stopPropagation();
                this.applyFavorite(fav);
            }, true);

            if (fav._isNew) {
                box.classList.add("zen-favorite-pop-in");
                delete fav._isNew;
                // Save immediately without markers
                this._saveFavs(this._getFavs().map(f => { delete f._isNew; return f; }));
            }
            return box;
        };

        const chunks = [];
        for (let i = 0; i < favs.length; i += 8) {
            chunks.push(favs.slice(i, i + 8));
        }

        const firstNative = pagesWrapper.querySelector("hbox:not(.zen-picker-favorites-page)");

        chunks.forEach(chunk => {
            const page = (document.createXULElement ? document.createXULElement("hbox") : document.createElement("hbox"));
            page.className = "zen-picker-favorites-page";
            chunk.forEach(fav => page.appendChild(createBox(fav)));
            while (page.children.length < 8) page.appendChild(createBox(null));
            pagesWrapper.insertBefore(page, firstNative);
        });
    }

    _animateState(toOp, toTex) {
        const picker = this.picker;
        const duration = 400;
        const start = performance.now();
        const fromOp = picker.currentOpacity;
        const fromTex = picker.currentTexture || 0;

        const step = (now) => {
            const p = Math.min(1, (now - start) / duration);
            const ease = 1 - Math.pow(1 - p, 4); // easeOutQuart for smoother finish

            picker.currentOpacity = fromOp + (toOp - fromOp) * ease;

            // Circular angular interpolation
            let diff = toTex - fromTex;
            if (diff > 0.5) diff -= 1;
            if (diff < -0.5) diff += 1;
            picker.currentTexture = (fromTex + diff * ease + 1) % 1;

            // Sync UI only
            picker.updateCurrentWorkspace(true);
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    applyFavorite(fav) {
        const picker = this.picker;
        const ws = gZenWorkspaces.getActiveWorkspace();
        if (!ws || !picker) return;

        // Trigger Transitions (Bug 3)
        picker.panel.classList.add("zen-favorites-restoring");

        // 1. Force Private State Restoration via Temporary Theme Update
        if (picker._rotationModule?.dialHandler) {
            picker._rotationModule.dialHandler.classList.add("zen-programmatic-change");
            setTimeout(() => picker._rotationModule.dialHandler?.classList.remove("zen-programmatic-change"), 500);
        }

        const restoredTheme = {
            type: "gradient",
            gradientColors: fav.dots.map(d => ({
                c: [0, 0, 0],
                isCustom: false,
                algorithm: fav.algo,
                isPrimary: false,
                lightness: fav.lightness,
                position: { x: d.x, y: d.y },
                type: fav.paletteType
            })),
            opacity: fav.opacity,
            texture: fav.texture,
            rotation: fav.rotation
        };

        const oldTheme = ws.theme;
        ws.theme = restoredTheme;

        // BUG 1 FIX: Call getGradient directly instead of getGradientForWorkspace.
        picker.getGradient(restoredTheme.gradientColors);

        // 2. Set Public Algorithmic State
        picker.useAlgo = fav.algo;
        this._animateState(fav.opacity, fav.texture || 0);

        if (picker._rotationModule) {
            picker._rotationModule.currentRotation = fav.rotation ?? -45;
            picker._rotationModule.applyRotation();
        }

        // 3. Sync Dot Count (UI only, preserve elements for motion)
        if (fav.numDots < picker.dots.length) {
            for (let i = fav.numDots; i < picker.dots.length; i++) {
                picker.dots[i].element?.remove();
            }
            picker.dots = picker.dots.slice(0, fav.numDots);
        }

        // 4. Prepare positions for UI update
        const colorPositions = fav.dots.map(d => ({
            ID: d.id,
            position: { x: d.x, y: d.y },
            type: fav.paletteType
        }));

        // 5. Final UI Sync & Save
        picker.handleColorPositions(colorPositions, true);

        // Use skipUpdate=true to preserve dots and enable spring motion
        picker.onWorkspaceChange(ws, true, ws.theme);
        gZenWorkspaces.saveWorkspace(ws); // Persist

        this.updateButtonState();

        setTimeout(() => picker.panel.classList.remove("zen-favorites-restoring"), 500);
    }
}

// Start Execution
if (document.readyState === "complete") {
    ZenPickerMods.init();
} else {
    window.addEventListener("load", () => ZenPickerMods.init());
}
