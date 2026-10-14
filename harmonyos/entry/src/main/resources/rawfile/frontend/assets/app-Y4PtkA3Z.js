//#region node_modules/@wailsio/runtime/dist/environment.js
/**
* True when running inside a browser/webview with a DOM available.
* False under server-side rendering (e.g. `next build` prerendering),
* where application code may import the runtime module even though no
* Wails APIs can actually be used (#4679). Modules must not touch
* `window`/`document` at import time except behind this guard.
*/
var hasDOM = typeof window !== "undefined" && typeof document !== "undefined";
//#endregion
//#region node_modules/@wailsio/runtime/dist/nanoid.js
var urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
function nanoid(size = 21) {
	const source = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function" ? crypto : null;
	if (source) {
		const bytes = new Uint8Array(size);
		source.getRandomValues(bytes);
		let id = "";
		for (let i = 0; i < size; i++) id += urlAlphabet[bytes[i] & 63];
		return id;
	}
	let id = "";
	let i = size | 0;
	while (i--) id += urlAlphabet[Math.random() * 64 | 0];
	return id;
}
//#endregion
//#region node_modules/@wailsio/runtime/dist/runtime.js
var _a$1;
function runtimeURL() {
	return window.location.origin + "/wails/runtime";
}
var CHUNK_THRESHOLD = 524288;
/**
* Exception class that will be thrown in case the bound method returns an error.
* The value of the {@link RuntimeError#name} property is "RuntimeError".
*/
var RuntimeError = class extends Error {
	/**
	* Constructs a new RuntimeError instance.
	* @param message - The error message.
	* @param options - Options to be forwarded to the Error constructor.
	*/
	constructor(message, options) {
		super(message, options);
		this.name = "RuntimeError";
	}
};
var objectNames = Object.freeze({
	Call: 0,
	Clipboard: 1,
	Application: 2,
	Events: 3,
	ContextMenu: 4,
	Dialog: 5,
	Window: 6,
	Screens: 7,
	System: 8,
	Browser: 9,
	CancelCall: 10,
	IOS: 11,
	Android: 12
});
var clientId = nanoid();
/**
* Custom transport implementation (can be set by user)
*/
var customTransport = null;
/**
* Creates a new runtime caller with specified ID.
*
* @param object - The object to invoke the method on.
* @param windowName - The name of the window.
* @return The new runtime caller function.
*/
function newRuntimeCaller(object, windowName = "") {
	return function(method, args = null) {
		return runtimeCallWithID(object, method, windowName, args);
	};
}
async function runtimeCallWithID(objectID, method, windowName, args) {
	var _a, _b;
	if (customTransport) return customTransport.call(objectID, method, windowName, args);
	let url = new URL(runtimeURL());
	let body = {
		object: objectID,
		method
	};
	if (args !== null && args !== void 0) body.args = args;
	let headers = {
		["x-wails-client-id"]: clientId,
		["Content-Type"]: "application/json"
	};
	if (windowName) headers["x-wails-window-name"] = windowName;
	const bodyStr = JSON.stringify(body);
	let response;
	if (bodyStr.length > CHUNK_THRESHOLD) response = await sendChunked(url, headers, bodyStr);
	else response = await fetch(url, {
		method: "POST",
		headers,
		body: bodyStr
	});
	if (!response.ok) {
		const ct = response.headers.get("Content-Type");
		if (ct === null || ct === void 0 ? void 0 : ct.includes("application/json")) {
			const json = await response.json();
			let err;
			switch (json.kind) {
				case "ReferenceError":
					err = new ReferenceError(json.message);
					break;
				case "TypeError":
					err = new TypeError(json.message);
					break;
				case "RuntimeError":
					err = new RuntimeError(json.message);
					break;
				default: err = new Error(json.message);
			}
			err.cause = json.cause;
			throw err;
		}
		throw new Error(await response.text());
	}
	if (((_b = (_a = response.headers.get("Content-Type")) === null || _a === void 0 ? void 0 : _a.indexOf("application/json")) !== null && _b !== void 0 ? _b : -1) !== -1) return response.json();
	else return response.text();
}
async function sendChunked(url, headers, bodyStr) {
	const chunkId = nanoid();
	const bodyBytes = new TextEncoder().encode(bodyStr);
	const totalChunks = Math.ceil(bodyBytes.length / CHUNK_THRESHOLD);
	for (let i = 0; i < totalChunks - 1; i++) {
		const chunk = bodyBytes.subarray(i * CHUNK_THRESHOLD, (i + 1) * CHUNK_THRESHOLD);
		const resp = await fetch(url, {
			method: "POST",
			headers: Object.assign(Object.assign({}, headers), {
				"x-wails-chunk-id": chunkId,
				"x-wails-chunk-index": String(i),
				"x-wails-chunk-total": String(totalChunks)
			}),
			body: chunk
		});
		if (!resp.ok) throw new Error(await resp.text());
	}
	return fetch(url, {
		method: "POST",
		headers: Object.assign(Object.assign({}, headers), {
			"x-wails-chunk-id": chunkId,
			"x-wails-chunk-index": String(totalChunks - 1),
			"x-wails-chunk-total": String(totalChunks)
		}),
		body: bodyBytes.subarray((totalChunks - 1) * CHUNK_THRESHOLD)
	});
}
var androidBridge = hasDOM && typeof ((_a$1 = window.wails) === null || _a$1 === void 0 ? void 0 : _a$1.invokeAsync) === "function" ? window.wails : null;
if (androidBridge) {
	const pending = /* @__PURE__ */ new Map();
	window._wailsAndroidCallback = (id, response, error) => {
		var _a;
		const promise = pending.get(id);
		if (!promise) return;
		pending.delete(id);
		if (error) {
			promise.reject(new Error(error));
			return;
		}
		try {
			const envelope = JSON.parse(response !== null && response !== void 0 ? response : "{}");
			if (!envelope.ok) {
				promise.reject(new Error((_a = envelope.error) !== null && _a !== void 0 ? _a : "unknown runtime call error"));
				return;
			}
			promise.resolve("text" in envelope ? envelope.text : envelope.data);
		} catch (e) {
			promise.reject(e);
		}
	};
	customTransport = { call(objectID, method, windowName, args) {
		return new Promise((resolve, reject) => {
			const id = nanoid();
			pending.set(id, {
				resolve,
				reject
			});
			try {
				androidBridge.invokeAsync(id, JSON.stringify({
					object: objectID,
					method,
					windowName,
					args: args !== null && args !== void 0 ? args : null,
					clientId
				}));
			} catch (e) {
				pending.delete(id);
				reject(e);
			}
		});
	} };
}
//#endregion
//#region node_modules/@wailsio/runtime/dist/system.js
var call$2 = newRuntimeCaller(objectNames.System);
var SystemEnvironment = 1;
var _invoke = (function() {
	var _a, _b, _c, _d, _e, _f;
	try {
		if ((_b = (_a = window.chrome) === null || _a === void 0 ? void 0 : _a.webview) === null || _b === void 0 ? void 0 : _b.postMessage) return window.chrome.webview.postMessage.bind(window.chrome.webview);
		else if ((_e = (_d = (_c = window.webkit) === null || _c === void 0 ? void 0 : _c.messageHandlers) === null || _d === void 0 ? void 0 : _d["external"]) === null || _e === void 0 ? void 0 : _e.postMessage) return window.webkit.messageHandlers["external"].postMessage.bind(window.webkit.messageHandlers["external"]);
		else if ((_f = window.wails) === null || _f === void 0 ? void 0 : _f.invoke) return (msg) => window.wails.invoke(typeof msg === "string" ? msg : JSON.stringify(msg));
	} catch (e) {}
	console.warn("\n%c⚠️ Browser Environment Detected %c\n\n%cOnly UI previews are available in the browser. For full functionality, please run the application in desktop mode.\nMore information at: https://v3.wails.io/learn/build/#using-a-browser-for-development\n", "background: #ffffff; color: #000000; font-weight: bold; padding: 4px 8px; border-radius: 4px; border: 2px solid #000000;", "background: transparent;", "color: #ffffff; font-style: italic; font-weight: bold;");
	return null;
})();
function invoke(msg) {
	_invoke === null || _invoke === void 0 || _invoke(msg);
}
/**
* Retrieves environment details.
*
* @returns A promise that resolves to an object containing OS and system architecture.
*/
function Environment() {
	return call$2(SystemEnvironment);
}
/**
* Checks if the current operating system is Windows.
*
* @return True if the operating system is Windows, otherwise false.
*/
function IsWindows() {
	var _a, _b;
	return ((_b = (_a = window._wails) === null || _a === void 0 ? void 0 : _a.environment) === null || _b === void 0 ? void 0 : _b.OS) === "windows";
}
/**
* Checks if the current operating system is Linux.
*
* @returns Returns true if the current operating system is Linux, false otherwise.
*/
function IsLinux() {
	var _a, _b;
	return ((_b = (_a = window._wails) === null || _a === void 0 ? void 0 : _a.environment) === null || _b === void 0 ? void 0 : _b.OS) === "linux";
}
/**
* Checks if the current environment is a macOS operating system.
*
* @returns True if the environment is macOS, false otherwise.
*/
function IsMac() {
	var _a, _b;
	return ((_b = (_a = window._wails) === null || _a === void 0 ? void 0 : _a.environment) === null || _b === void 0 ? void 0 : _b.OS) === "darwin";
}
/**
* Reports whether the app is being run in debug mode.
*
* @returns True if the app is being run in debug mode.
*/
function IsDebug() {
	var _a, _b;
	return Boolean((_b = (_a = window._wails) === null || _a === void 0 ? void 0 : _a.environment) === null || _b === void 0 ? void 0 : _b.Debug);
}
//#endregion
//#region node_modules/@wailsio/runtime/dist/utils.js
/**
* Checks whether the webview supports the {@link MouseEvent#buttons} property.
* Looking at you macOS High Sierra!
*/
function canTrackButtons() {
	return new MouseEvent("mousedown").buttons === 0;
}
/**
* Resolves the closest HTMLElement ancestor of an event's target.
*/
function eventTarget(event) {
	var _a;
	if (event.target instanceof HTMLElement) return event.target;
	else if (!(event.target instanceof HTMLElement) && event.target instanceof Node) return (_a = event.target.parentElement) !== null && _a !== void 0 ? _a : document.body;
	else return document.body;
}
/***
This technique for proper load detection is taken from HTMX:

BSD 2-Clause License

Copyright (c) 2020, Big Sky Software
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation
and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

***/
var isReady = false;
if (hasDOM) document.addEventListener("DOMContentLoaded", () => {
	isReady = true;
});
function whenReady(callback) {
	if (isReady || document.readyState === "complete") callback();
	else document.addEventListener("DOMContentLoaded", callback);
}
//#endregion
//#region node_modules/@wailsio/runtime/dist/contextmenu.js
if (hasDOM) window.addEventListener("contextmenu", contextMenuHandler);
var call$1 = newRuntimeCaller(objectNames.ContextMenu);
var ContextMenuOpen = 0;
function openContextMenu(id, x, y, data) {
	call$1(ContextMenuOpen, {
		id,
		x,
		y,
		data
	});
}
function contextMenuHandler(event) {
	const target = eventTarget(event);
	const customContextMenu = window.getComputedStyle(target).getPropertyValue("--custom-contextmenu").trim();
	if (customContextMenu) {
		event.preventDefault();
		const data = window.getComputedStyle(target).getPropertyValue("--custom-contextmenu-data");
		openContextMenu(customContextMenu, event.clientX, event.clientY, data);
	} else processDefaultContextMenu(event, target);
}
function processDefaultContextMenu(event, target) {
	if (IsDebug()) return;
	switch (window.getComputedStyle(target).getPropertyValue("--default-contextmenu").trim()) {
		case "show": return;
		case "hide":
			event.preventDefault();
			return;
	}
	if (target.isContentEditable) return;
	const selection = window.getSelection();
	const hasSelection = selection && selection.toString().length > 0;
	if (hasSelection) for (let i = 0; i < selection.rangeCount; i++) {
		const rects = selection.getRangeAt(i).getClientRects();
		for (let j = 0; j < rects.length; j++) {
			const rect = rects[j];
			if (document.elementFromPoint(rect.left, rect.top) === target) return;
		}
	}
	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
		if (hasSelection || !target.readOnly && !target.disabled) return;
	}
	event.preventDefault();
}
//#endregion
//#region node_modules/@wailsio/runtime/dist/flags.js
/**
* Retrieves the value associated with the specified key from the flag map.
*
* @param key - The key to retrieve the value for.
* @return The value associated with the specified key.
*/
function GetFlag(key) {
	try {
		return window._wails.flags[key];
	} catch (e) {
		throw new Error("Unable to retrieve flag '" + key + "': " + e, { cause: e });
	}
}
//#endregion
//#region node_modules/@wailsio/runtime/dist/drag.js
var canDrag = false;
var dragging = false;
var resizable = false;
var canResize = false;
var resizing = false;
var resizeEdge = "";
var defaultCursor = "auto";
var buttons = 0;
var buttonsTracked = false;
if (hasDOM) {
	buttonsTracked = canTrackButtons();
	window._wails = window._wails || {};
	window._wails.setResizable = (value) => {
		resizable = value;
		if (!resizable) {
			canResize = resizing = false;
			setResize();
		}
	};
}
var dragInitDone = false;
function isMobile() {
	var _a, _b;
	const os = (_b = (_a = window._wails) === null || _a === void 0 ? void 0 : _a.environment) === null || _b === void 0 ? void 0 : _b.OS;
	if (os === "ios" || os === "android") return true;
	const ua = navigator.userAgent || navigator.vendor || window.opera || "";
	return /android|iphone|ipad|ipod|iemobile|wpdesktop/i.test(ua);
}
function tryInitDragHandlers() {
	if (dragInitDone) return;
	if (isMobile()) return;
	window.addEventListener("mousedown", update, { capture: true });
	window.addEventListener("mousemove", update, { capture: true });
	window.addEventListener("mouseup", update, { capture: true });
	for (const ev of [
		"click",
		"contextmenu",
		"dblclick"
	]) window.addEventListener(ev, suppressEvent, { capture: true });
	dragInitDone = true;
}
if (hasDOM) {
	tryInitDragHandlers();
	document.addEventListener("DOMContentLoaded", tryInitDragHandlers, { once: true });
	let dragEnvPolls = 0;
	const dragEnvPoll = window.setInterval(() => {
		if (dragInitDone) {
			window.clearInterval(dragEnvPoll);
			return;
		}
		tryInitDragHandlers();
		if (++dragEnvPolls > 100) window.clearInterval(dragEnvPoll);
	}, 50);
}
function suppressEvent(event) {
	if (event.type === "dblclick" && IsMac() && window === window.top && isDraggableEvent(event)) {
		event.stopImmediatePropagation();
		event.stopPropagation();
		event.preventDefault();
		invoke("wails:drag:doubleclick");
		return;
	}
	if (dragging || resizing) {
		event.stopImmediatePropagation();
		event.stopPropagation();
		event.preventDefault();
	}
}
function isDraggableEvent(event) {
	const target = eventTarget(event);
	return window.getComputedStyle(target).getPropertyValue("--wails-draggable").trim() === "drag" && event.offsetX >= 0 && event.offsetX < target.clientWidth && event.offsetY >= 0 && event.offsetY < target.clientHeight;
}
var MouseDown = 0;
var MouseUp = 1;
var MouseMove = 2;
function update(event) {
	let eventType, eventButtons = event.buttons;
	switch (event.type) {
		case "mousedown":
			eventType = MouseDown;
			if (!buttonsTracked) eventButtons = buttons | 1 << event.button;
			break;
		case "mouseup":
			eventType = MouseUp;
			if (!buttonsTracked) eventButtons = buttons & ~(1 << event.button);
			break;
		default:
			eventType = MouseMove;
			if (!buttonsTracked) eventButtons = buttons;
	}
	let released = buttons & ~eventButtons;
	let pressed = eventButtons & ~buttons;
	buttons = eventButtons;
	if (eventType === MouseDown && !(pressed & event.button)) {
		released |= 1 << event.button;
		pressed |= 1 << event.button;
	}
	if (eventType !== MouseMove && resizing || dragging && (eventType === MouseDown || event.button !== 0)) {
		event.stopImmediatePropagation();
		event.stopPropagation();
		event.preventDefault();
	}
	if (released & 1) primaryUp(event);
	if (pressed & 1) primaryDown(event);
	if (eventType === MouseMove) onMouseMove(event);
}
function primaryDown(event) {
	canDrag = false;
	canResize = false;
	if (!IsWindows()) {
		if (event.type === "mousedown" && event.button === 0 && event.detail !== 1) return;
	}
	if (resizeEdge) {
		if (event.type !== "mousedown") return;
		canResize = true;
		return;
	}
	canDrag = isDraggableEvent(event);
}
function primaryUp(event) {
	canDrag = false;
	dragging = false;
	canResize = false;
	resizing = false;
}
var cursorForEdge = Object.freeze({
	"se-resize": "nwse-resize",
	"sw-resize": "nesw-resize",
	"nw-resize": "nwse-resize",
	"ne-resize": "nesw-resize",
	"w-resize": "ew-resize",
	"n-resize": "ns-resize",
	"s-resize": "ns-resize",
	"e-resize": "ew-resize"
});
function setResize(edge) {
	if (edge) {
		if (!resizeEdge) defaultCursor = document.body.style.cursor;
		document.body.style.cursor = cursorForEdge[edge];
	} else if (!edge && resizeEdge) document.body.style.cursor = defaultCursor;
	resizeEdge = edge || "";
}
function onMouseMove(event) {
	if (canResize && resizeEdge) {
		resizing = true;
		invoke("wails:resize:" + resizeEdge);
	} else if (canDrag) {
		dragging = true;
		invoke("wails:drag");
	}
	if (dragging || resizing) {
		canDrag = canResize = false;
		return;
	}
	if (!resizable || !IsWindows() && !(IsLinux() && GetFlag("frameless"))) {
		if (resizeEdge) setResize();
		return;
	}
	const resizeHandleHeight = GetFlag("system.resizeHandleHeight") || 5;
	const resizeHandleWidth = GetFlag("system.resizeHandleWidth") || 5;
	const cornerExtra = GetFlag("resizeCornerExtra") || 10;
	const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
	const scrollbarHeight = Math.max(0, window.innerHeight - document.documentElement.clientHeight);
	const rightContentEdge = window.innerWidth - scrollbarWidth;
	const bottomContentEdge = window.innerHeight - scrollbarHeight;
	const rightBorder = event.clientX < rightContentEdge && rightContentEdge - event.clientX < resizeHandleWidth;
	const leftBorder = event.clientX < resizeHandleWidth;
	const topBorder = event.clientY < resizeHandleHeight;
	const bottomBorder = event.clientY < bottomContentEdge && bottomContentEdge - event.clientY < resizeHandleHeight;
	const rightCorner = event.clientX < rightContentEdge && rightContentEdge - event.clientX < resizeHandleWidth + cornerExtra;
	const leftCorner = event.clientX < resizeHandleWidth + cornerExtra;
	const topCorner = event.clientY < resizeHandleHeight + cornerExtra;
	const bottomCorner = event.clientY < bottomContentEdge && bottomContentEdge - event.clientY < resizeHandleHeight + cornerExtra;
	if (!leftCorner && !topCorner && !bottomCorner && !rightCorner) setResize();
	else if (rightCorner && bottomCorner) setResize("se-resize");
	else if (leftCorner && bottomCorner) setResize("sw-resize");
	else if (leftCorner && topCorner) setResize("nw-resize");
	else if (topCorner && rightCorner) setResize("ne-resize");
	else if (leftBorder) setResize("w-resize");
	else if (topBorder) setResize("n-resize");
	else if (bottomBorder) setResize("s-resize");
	else if (rightBorder) setResize("e-resize");
	else setResize();
}
//#endregion
//#region node_modules/@wailsio/runtime/dist/appregion.js
var regionProperty = "--wails-non-client-region";
var runtimeConfigReadyEvent = "wails:runtime-config-ready";
var validRegions = /* @__PURE__ */ new Set([
	"caption",
	"minimize",
	"maximize",
	"close"
]);
if (hasDOM) window._wails = window._wails || {};
var updatePending = false;
var lastPayload = "";
var observedElements = /* @__PURE__ */ new Set();
var resizeObserver;
var trackingStarted = false;
function normaliseRegionKind(value) {
	const region = value.trim().toLowerCase();
	if (validRegions.has(region)) return region;
}
function nonClientRegionForElement(element) {
	if (!(element instanceof HTMLElement)) return;
	const region = normaliseRegionKind(window.getComputedStyle(element).getPropertyValue(regionProperty));
	if (!region) return;
	const parent = element.parentElement;
	if (parent) {
		if (normaliseRegionKind(window.getComputedStyle(parent).getPropertyValue(regionProperty)) === region) return;
	}
	return region;
}
function isVisible(element) {
	const style = window.getComputedStyle(element);
	return style.display !== "none" && style.visibility !== "hidden" && style.contentVisibility !== "hidden";
}
function elementRegion(element) {
	if (!(element instanceof HTMLElement)) return;
	const kind = nonClientRegionForElement(element);
	if (!kind || !isVisible(element)) return;
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return;
	const scale = window.devicePixelRatio || 1;
	const left = Math.floor(rect.left * scale);
	const top = Math.floor(rect.top * scale);
	const right = Math.ceil(rect.right * scale);
	const bottom = Math.ceil(rect.bottom * scale);
	if (right <= left || bottom <= top) return;
	return {
		kind,
		left,
		top,
		right,
		bottom
	};
}
function regionElements() {
	const elements = [];
	if (document.documentElement) elements.push(document.documentElement);
	if (document.body) {
		elements.push(document.body);
		for (const element of document.body.querySelectorAll("*")) elements.push(element);
	}
	return elements;
}
function observeRegionElements(elements) {
	if (typeof ResizeObserver === "undefined") return;
	resizeObserver !== null && resizeObserver !== void 0 || (resizeObserver = new ResizeObserver(scheduleUpdate));
	const nextElements = new Set(elements);
	for (const element of observedElements) if (!nextElements.has(element)) resizeObserver.unobserve(element);
	for (const element of nextElements) if (!observedElements.has(element)) resizeObserver.observe(element);
	observedElements = nextElements;
}
function updateNonClientRegions() {
	updatePending = false;
	const elements = regionElements();
	const regions = [];
	const activeElements = [];
	for (const element of elements) {
		const region = elementRegion(element);
		if (region) {
			regions.push(region);
			activeElements.push(element);
		}
	}
	observeRegionElements(activeElements);
	const payload = JSON.stringify({
		version: 1,
		regions
	});
	if (payload === lastPayload) return;
	lastPayload = payload;
	invoke("wails:non-client-region:" + payload);
}
function scheduleUpdate() {
	if (updatePending) return;
	updatePending = true;
	window.requestAnimationFrame(updateNonClientRegions);
}
function startNonClientRegionTracking() {
	var _a, _b;
	if (trackingStarted) return;
	trackingStarted = true;
	scheduleUpdate();
	new MutationObserver(scheduleUpdate).observe(document.documentElement, {
		attributes: true,
		childList: true,
		subtree: true
	});
	window.addEventListener("resize", scheduleUpdate);
	window.addEventListener("scroll", scheduleUpdate, true);
	(_a = window.visualViewport) === null || _a === void 0 || _a.addEventListener("resize", scheduleUpdate);
	(_b = window.visualViewport) === null || _b === void 0 || _b.addEventListener("scroll", scheduleUpdate);
}
function tryStartNonClientRegionTracking() {
	var _a, _b;
	const os = (_a = window._wails.environment) === null || _a === void 0 ? void 0 : _a.OS;
	if (os === void 0) return false;
	const enabled = (_b = window._wails.flags) === null || _b === void 0 ? void 0 : _b.nonClientRegionTracking;
	if (os === "windows") {
		if (enabled === true) whenReady(startNonClientRegionTracking);
		return true;
	}
	return true;
}
if (hasDOM && !tryStartNonClientRegionTracking()) window.addEventListener(runtimeConfigReadyEvent, tryStartNonClientRegionTracking, { once: true });
//#endregion
//#region node_modules/@wailsio/runtime/dist/callable.js
var fnToStr = Function.prototype.toString;
var reflectApply = typeof Reflect === "object" && Reflect !== null && Reflect.apply;
var badArrayLike;
var isCallableMarker;
if (typeof reflectApply === "function" && typeof Object.defineProperty === "function") try {
	badArrayLike = Object.defineProperty({}, "length", { get: function() {
		throw isCallableMarker;
	} });
	isCallableMarker = {};
	reflectApply(function() {
		throw 42;
	}, null, badArrayLike);
} catch (_) {
	if (_ !== isCallableMarker) reflectApply = null;
}
else reflectApply = null;
var constructorRegex = /^\s*class\b/;
var isES6ClassFn = function isES6ClassFunction(value) {
	try {
		var fnStr = fnToStr.call(value);
		return constructorRegex.test(fnStr);
	} catch (e) {
		return false;
	}
};
var tryFunctionObject = function tryFunctionToStr(value) {
	try {
		if (isES6ClassFn(value)) return false;
		fnToStr.call(value);
		return true;
	} catch (e) {
		return false;
	}
};
var toStr = Object.prototype.toString;
var objectClass = "[object Object]";
var fnClass = "[object Function]";
var genClass = "[object GeneratorFunction]";
var ddaClass = "[object HTMLAllCollection]";
var ddaClass2 = "[object HTML document.all class]";
var ddaClass3 = "[object HTMLCollection]";
var hasToStringTag = typeof Symbol === "function" && !!Symbol.toStringTag;
var isIE68 = !(0 in [,]);
var isDDA = function isDocumentDotAll() {
	return false;
};
if (typeof document === "object") {
	var all = document.all;
	if (toStr.call(all) === toStr.call(document.all)) isDDA = function isDocumentDotAll(value) {
		if ((isIE68 || !value) && (typeof value === "undefined" || typeof value === "object")) try {
			var str = toStr.call(value);
			return (str === ddaClass || str === ddaClass2 || str === ddaClass3 || str === objectClass) && value("") == null;
		} catch (e) {}
		return false;
	};
}
function isCallableRefApply(value) {
	if (isDDA(value)) return true;
	if (!value) return false;
	if (typeof value !== "function" && typeof value !== "object") return false;
	try {
		reflectApply(value, null, badArrayLike);
	} catch (e) {
		if (e !== isCallableMarker) return false;
	}
	return !isES6ClassFn(value) && tryFunctionObject(value);
}
function isCallableNoRefApply(value) {
	if (isDDA(value)) return true;
	if (!value) return false;
	if (typeof value !== "function" && typeof value !== "object") return false;
	if (hasToStringTag) return tryFunctionObject(value);
	if (isES6ClassFn(value)) return false;
	var strClass = toStr.call(value);
	if (strClass !== fnClass && strClass !== genClass && !/^\[object HTML/.test(strClass)) return false;
	return tryFunctionObject(value);
}
var callable_default = reflectApply ? isCallableRefApply : isCallableNoRefApply;
//#endregion
//#region node_modules/@wailsio/runtime/dist/cancellable.js
var _a;
/**
* Exception class that will be used as rejection reason
* in case a {@link CancellablePromise} is cancelled successfully.
*
* The value of the {@link name} property is the string `"CancelError"`.
* The value of the {@link cause} property is the cause passed to the cancel method, if any.
*/
var CancelError = class extends Error {
	/**
	* Constructs a new `CancelError` instance.
	* @param message - The error message.
	* @param options - Options to be forwarded to the Error constructor.
	*/
	constructor(message, options) {
		super(message, options);
		this.name = "CancelError";
	}
};
/**
* Exception class that will be reported as an unhandled rejection
* in case a {@link CancellablePromise} rejects after being cancelled,
* or when the `oncancelled` callback throws or rejects.
*
* The value of the {@link name} property is the string `"CancelledRejectionError"`.
* The value of the {@link cause} property is the reason the promise rejected with.
*
* Because the original promise was cancelled,
* a wrapper promise will be passed to the unhandled rejection listener instead.
* The {@link promise} property holds a reference to the original promise.
*/
var CancelledRejectionError = class extends Error {
	/**
	* Constructs a new `CancelledRejectionError` instance.
	* @param promise - The promise that caused the error originally.
	* @param reason - The rejection reason.
	* @param info - An optional informative message specifying the circumstances in which the error was thrown.
	*               Defaults to the string `"Unhandled rejection in cancelled promise."`.
	*/
	constructor(promise, reason, info) {
		super((info !== null && info !== void 0 ? info : "Unhandled rejection in cancelled promise.") + " Reason: " + errorMessage(reason), { cause: reason });
		this.promise = promise;
		this.name = "CancelledRejectionError";
	}
};
var barrierSym = Symbol("barrier");
var cancelImplSym = Symbol("cancelImpl");
var species = (_a = Symbol.species) !== null && _a !== void 0 ? _a : Symbol("speciesPolyfill");
/**
* A promise with an attached method for cancelling long-running operations (see {@link CancellablePromise#cancel}).
* Cancellation can optionally be bound to an {@link AbortSignal}
* for better composability (see {@link CancellablePromise#cancelOn}).
*
* Cancelling a pending promise will result in an immediate rejection
* with an instance of {@link CancelError} as reason,
* but whoever started the promise will be responsible
* for actually aborting the underlying operation.
* To this purpose, the constructor and all chaining methods
* accept optional cancellation callbacks.
*
* If a `CancellablePromise` still resolves after having been cancelled,
* the result will be discarded. If it rejects, the reason
* will be reported as an unhandled rejection,
* wrapped in a {@link CancelledRejectionError} instance.
* To facilitate the handling of cancellation requests,
* cancelled `CancellablePromise`s will _not_ report unhandled `CancelError`s
* whose `cause` field is the same as the one with which the current promise was cancelled.
*
* All usual promise methods are defined and return a `CancellablePromise`
* whose cancel method will cancel the parent operation as well, propagating the cancellation reason
* upwards through promise chains.
* Conversely, cancelling a promise will not automatically cancel dependent promises downstream:
* ```ts
* let root = new CancellablePromise((resolve, reject) => { ... });
* let child1 = root.then(() => { ... });
* let child2 = child1.then(() => { ... });
* let child3 = root.catch(() => { ... });
* child1.cancel(); // Cancels child1 and root, but not child2 or child3
* ```
* Cancelling a promise that has already settled is safe and has no consequence.
*
* The `cancel` method returns a promise that _always fulfills_
* after the whole chain has processed the cancel request
* and all attached callbacks up to that moment have run.
*
* All ES2024 promise methods (static and instance) are defined on CancellablePromise,
* but actual availability may vary with OS/webview version.
*
* In line with the proposal at https://github.com/tc39/proposal-rm-builtin-subclassing,
* `CancellablePromise` does not support transparent subclassing.
* Extenders should take care to provide their own method implementations.
* This might be reconsidered in case the proposal is retired.
*
* CancellablePromise is a wrapper around the DOM Promise object
* and is compliant with the [Promises/A+ specification](https://promisesaplus.com/)
* (it passes the [compliance suite](https://github.com/promises-aplus/promises-tests))
* if so is the underlying implementation.
*/
var CancellablePromise = class CancellablePromise extends Promise {
	/**
	* Creates a new `CancellablePromise`.
	*
	* @param executor - A callback used to initialize the promise. This callback is passed two arguments:
	*                   a `resolve` callback used to resolve the promise with a value
	*                   or the result of another promise (possibly cancellable),
	*                   and a `reject` callback used to reject the promise with a provided reason or error.
	*                   If the value provided to the `resolve` callback is a thenable _and_ cancellable object
	*                   (it has a `then` _and_ a `cancel` method),
	*                   cancellation requests will be forwarded to that object and the oncancelled will not be invoked anymore.
	*                   If any one of the two callbacks is called _after_ the promise has been cancelled,
	*                   the provided values will be cancelled and resolved as usual,
	*                   but their results will be discarded.
	*                   However, if the resolution process ultimately ends up in a rejection
	*                   that is not due to cancellation, the rejection reason
	*                   will be wrapped in a {@link CancelledRejectionError}
	*                   and bubbled up as an unhandled rejection.
	* @param oncancelled - It is the caller's responsibility to ensure that any operation
	*                      started by the executor is properly halted upon cancellation.
	*                      This optional callback can be used to that purpose.
	*                      It will be called _synchronously_ with a cancellation cause
	*                      when cancellation is requested, _after_ the promise has already rejected
	*                      with a {@link CancelError}, but _before_
	*                      any {@link then}/{@link catch}/{@link finally} callback runs.
	*                      If the callback returns a thenable, the promise returned from {@link cancel}
	*                      will only fulfill after the former has settled.
	*                      Unhandled exceptions or rejections from the callback will be wrapped
	*                      in a {@link CancelledRejectionError} and bubbled up as unhandled rejections.
	*                      If the `resolve` callback is called before cancellation with a cancellable promise,
	*                      cancellation requests on this promise will be diverted to that promise,
	*                      and the original `oncancelled` callback will be discarded.
	*/
	constructor(executor, oncancelled) {
		let resolve;
		let reject;
		super((res, rej) => {
			resolve = res;
			reject = rej;
		});
		if (this.constructor[species] !== Promise) throw new TypeError("CancellablePromise does not support transparent subclassing. Please refrain from overriding the [Symbol.species] static property.");
		let promise = {
			promise: this,
			resolve,
			reject,
			get oncancelled() {
				return oncancelled !== null && oncancelled !== void 0 ? oncancelled : null;
			},
			set oncancelled(cb) {
				oncancelled = cb !== null && cb !== void 0 ? cb : void 0;
			}
		};
		const state = {
			get root() {
				return state;
			},
			resolving: false,
			settled: false
		};
		Object.defineProperties(this, {
			[barrierSym]: {
				configurable: false,
				enumerable: false,
				writable: true,
				value: null
			},
			[cancelImplSym]: {
				configurable: false,
				enumerable: false,
				writable: false,
				value: cancellerFor(promise, state)
			}
		});
		const rejector = rejectorFor(promise, state);
		try {
			executor(resolverFor(promise, state), rejector);
		} catch (err) {
			if (state.resolving) console.log("Unhandled exception in CancellablePromise executor.", err);
			else rejector(err);
		}
	}
	/**
	* Cancels immediately the execution of the operation associated with this promise.
	* The promise rejects with a {@link CancelError} instance as reason,
	* with the {@link CancelError#cause} property set to the given argument, if any.
	*
	* Has no effect if called after the promise has already settled;
	* repeated calls in particular are safe, but only the first one
	* will set the cancellation cause.
	*
	* The `CancelError` exception _need not_ be handled explicitly _on the promises that are being cancelled:_
	* cancelling a promise with no attached rejection handler does not trigger an unhandled rejection event.
	* Therefore, the following idioms are all equally correct:
	* ```ts
	* new CancellablePromise((resolve, reject) => { ... }).cancel();
	* new CancellablePromise((resolve, reject) => { ... }).then(...).cancel();
	* new CancellablePromise((resolve, reject) => { ... }).then(...).catch(...).cancel();
	* ```
	* Whenever some cancelled promise in a chain rejects with a `CancelError`
	* with the same cancellation cause as itself, the error will be discarded silently.
	* However, the `CancelError` _will still be delivered_ to all attached rejection handlers
	* added by {@link then} and related methods:
	* ```ts
	* let cancellable = new CancellablePromise((resolve, reject) => { ... });
	* cancellable.then(() => { ... }).catch(console.log);
	* cancellable.cancel(); // A CancelError is printed to the console.
	* ```
	* If the `CancelError` is not handled downstream by the time it reaches
	* a _non-cancelled_ promise, it _will_ trigger an unhandled rejection event,
	* just like normal rejections would:
	* ```ts
	* let cancellable = new CancellablePromise((resolve, reject) => { ... });
	* let chained = cancellable.then(() => { ... }).then(() => { ... }); // No catch...
	* cancellable.cancel(); // Unhandled rejection event on chained!
	* ```
	* Therefore, it is important to either cancel whole promise chains from their tail,
	* as shown in the correct idioms above, or take care of handling errors everywhere.
	*
	* @returns A cancellable promise that _fulfills_ after the cancel callback (if any)
	* and all handlers attached up to the call to cancel have run.
	* If the cancel callback returns a thenable, the promise returned by `cancel`
	* will also wait for that thenable to settle.
	* This enables callers to wait for the cancelled operation to terminate
	* without being forced to handle potential errors at the call site.
	* ```ts
	* cancellable.cancel().then(() => {
	*     // Cleanup finished, it's safe to do something else.
	* }, (err) => {
	*     // Unreachable: the promise returned from cancel will never reject.
	* });
	* ```
	* Note that the returned promise will _not_ handle implicitly any rejection
	* that might have occurred already in the cancelled chain.
	* It will just track whether registered handlers have been executed or not.
	* Therefore, unhandled rejections will never be silently handled by calling cancel.
	*/
	cancel(cause) {
		return new CancellablePromise((resolve) => {
			Promise.all([this[cancelImplSym](new CancelError("Promise cancelled.", { cause })), currentBarrier(this)]).then(() => resolve(), () => resolve());
		});
	}
	/**
	* Binds promise cancellation to the abort event of the given {@link AbortSignal}.
	* If the signal has already aborted, the promise will be cancelled immediately.
	* When either condition is verified, the cancellation cause will be set
	* to the signal's abort reason (see {@link AbortSignal#reason}).
	*
	* Has no effect if called (or if the signal aborts) _after_ the promise has already settled.
	* Only the first signal to abort will set the cancellation cause.
	*
	* For more details about the cancellation process,
	* see {@link cancel} and the `CancellablePromise` constructor.
	*
	* This method enables `await`ing cancellable promises without having
	* to store them for future cancellation, e.g.:
	* ```ts
	* await longRunningOperation().cancelOn(signal);
	* ```
	* instead of:
	* ```ts
	* let promiseToBeCancelled = longRunningOperation();
	* await promiseToBeCancelled;
	* ```
	*
	* @returns This promise, for method chaining.
	*/
	cancelOn(signal) {
		if (signal.aborted) this.cancel(signal.reason);
		else signal.addEventListener("abort", () => void this.cancel(signal.reason), { capture: true });
		return this;
	}
	/**
	* Attaches callbacks for the resolution and/or rejection of the `CancellablePromise`.
	*
	* The optional `oncancelled` argument will be invoked when the returned promise is cancelled,
	* with the same semantics as the `oncancelled` argument of the constructor.
	* When the parent promise rejects or is cancelled, the `onrejected` callback will run,
	* _even after the returned promise has been cancelled:_
	* in that case, should it reject or throw, the reason will be wrapped
	* in a {@link CancelledRejectionError} and bubbled up as an unhandled rejection.
	*
	* @param onfulfilled The callback to execute when the Promise is resolved.
	* @param onrejected The callback to execute when the Promise is rejected.
	* @returns A `CancellablePromise` for the completion of whichever callback is executed.
	* The returned promise is hooked up to propagate cancellation requests up the chain, but not down:
	*
	*   - if the parent promise is cancelled, the `onrejected` handler will be invoked with a `CancelError`
	*     and the returned promise _will resolve regularly_ with its result;
	*   - conversely, if the returned promise is cancelled, _the parent promise is cancelled too;_
	*     the `onrejected` handler will still be invoked with the parent's `CancelError`,
	*     but its result will be discarded
	*     and the returned promise will reject with a `CancelError` as well.
	*
	* The promise returned from {@link cancel} will fulfill only after all attached handlers
	* up the entire promise chain have been run.
	*
	* If either callback returns a cancellable promise,
	* cancellation requests will be diverted to it,
	* and the specified `oncancelled` callback will be discarded.
	*/
	then(onfulfilled, onrejected, oncancelled) {
		if (!(this instanceof CancellablePromise)) throw new TypeError("CancellablePromise.prototype.then called on an invalid object.");
		if (!callable_default(onfulfilled)) onfulfilled = identity;
		if (!callable_default(onrejected)) onrejected = thrower;
		if (onfulfilled === identity && onrejected == thrower) return new CancellablePromise((resolve) => resolve(this));
		const barrier = {};
		this[barrierSym] = barrier;
		return new CancellablePromise((resolve, reject) => {
			super.then((value) => {
				var _a;
				if (this[barrierSym] === barrier) this[barrierSym] = null;
				(_a = barrier.resolve) === null || _a === void 0 || _a.call(barrier);
				try {
					resolve(onfulfilled(value));
				} catch (err) {
					reject(err);
				}
			}, (reason) => {
				var _a;
				if (this[barrierSym] === barrier) this[barrierSym] = null;
				(_a = barrier.resolve) === null || _a === void 0 || _a.call(barrier);
				try {
					resolve(onrejected(reason));
				} catch (err) {
					reject(err);
				}
			});
		}, async (cause) => {
			try {
				return oncancelled === null || oncancelled === void 0 ? void 0 : oncancelled(cause);
			} finally {
				await this.cancel(cause);
			}
		});
	}
	/**
	* Attaches a callback for only the rejection of the Promise.
	*
	* The optional `oncancelled` argument will be invoked when the returned promise is cancelled,
	* with the same semantics as the `oncancelled` argument of the constructor.
	* When the parent promise rejects or is cancelled, the `onrejected` callback will run,
	* _even after the returned promise has been cancelled:_
	* in that case, should it reject or throw, the reason will be wrapped
	* in a {@link CancelledRejectionError} and bubbled up as an unhandled rejection.
	*
	* It is equivalent to
	* ```ts
	* cancellablePromise.then(undefined, onrejected, oncancelled);
	* ```
	* and the same caveats apply.
	*
	* @returns A Promise for the completion of the callback.
	* Cancellation requests on the returned promise
	* will propagate up the chain to the parent promise,
	* but not in the other direction.
	*
	* The promise returned from {@link cancel} will fulfill only after all attached handlers
	* up the entire promise chain have been run.
	*
	* If `onrejected` returns a cancellable promise,
	* cancellation requests will be diverted to it,
	* and the specified `oncancelled` callback will be discarded.
	* See {@link then} for more details.
	*/
	catch(onrejected, oncancelled) {
		return this.then(void 0, onrejected, oncancelled);
	}
	/**
	* Attaches a callback that is invoked when the CancellablePromise is settled (fulfilled or rejected). The
	* resolved value cannot be accessed or modified from the callback.
	* The returned promise will settle in the same state as the original one
	* after the provided callback has completed execution,
	* unless the callback throws or returns a rejecting promise,
	* in which case the returned promise will reject as well.
	*
	* The optional `oncancelled` argument will be invoked when the returned promise is cancelled,
	* with the same semantics as the `oncancelled` argument of the constructor.
	* Once the parent promise settles, the `onfinally` callback will run,
	* _even after the returned promise has been cancelled:_
	* in that case, should it reject or throw, the reason will be wrapped
	* in a {@link CancelledRejectionError} and bubbled up as an unhandled rejection.
	*
	* This method is implemented in terms of {@link then} and the same caveats apply.
	* It is polyfilled, hence available in every OS/webview version.
	*
	* @returns A Promise for the completion of the callback.
	* Cancellation requests on the returned promise
	* will propagate up the chain to the parent promise,
	* but not in the other direction.
	*
	* The promise returned from {@link cancel} will fulfill only after all attached handlers
	* up the entire promise chain have been run.
	*
	* If `onfinally` returns a cancellable promise,
	* cancellation requests will be diverted to it,
	* and the specified `oncancelled` callback will be discarded.
	* See {@link then} for more details.
	*/
	finally(onfinally, oncancelled) {
		if (!(this instanceof CancellablePromise)) throw new TypeError("CancellablePromise.prototype.finally called on an invalid object.");
		if (!callable_default(onfinally)) return this.then(onfinally, onfinally, oncancelled);
		return this.then((value) => CancellablePromise.resolve(onfinally()).then(() => value), (reason) => CancellablePromise.resolve(onfinally()).then(() => {
			throw reason;
		}), oncancelled);
	}
	/**
	* We use the `[Symbol.species]` static property, if available,
	* to disable the built-in automatic subclassing features from {@link Promise}.
	* It is critical for performance reasons that extenders do not override this.
	* Once the proposal at https://github.com/tc39/proposal-rm-builtin-subclassing
	* is either accepted or retired, this implementation will have to be revised accordingly.
	*
	* @ignore
	* @internal
	*/
	static get [species]() {
		return Promise;
	}
	static all(values) {
		let collected = Array.from(values);
		const promise = collected.length === 0 ? CancellablePromise.resolve(collected) : new CancellablePromise((resolve, reject) => {
			Promise.all(collected).then(resolve, reject);
		}, (cause) => cancelAll(promise, collected, cause));
		return promise;
	}
	static allSettled(values) {
		let collected = Array.from(values);
		const promise = collected.length === 0 ? CancellablePromise.resolve(collected) : new CancellablePromise((resolve, reject) => {
			Promise.allSettled(collected).then(resolve, reject);
		}, (cause) => cancelAll(promise, collected, cause));
		return promise;
	}
	static any(values) {
		let collected = Array.from(values);
		const promise = collected.length === 0 ? CancellablePromise.resolve(collected) : new CancellablePromise((resolve, reject) => {
			Promise.any(collected).then(resolve, reject);
		}, (cause) => cancelAll(promise, collected, cause));
		return promise;
	}
	static race(values) {
		let collected = Array.from(values);
		const promise = new CancellablePromise((resolve, reject) => {
			Promise.race(collected).then(resolve, reject);
		}, (cause) => cancelAll(promise, collected, cause));
		return promise;
	}
	/**
	* Creates a new cancelled CancellablePromise for the provided cause.
	*
	* @group Static Methods
	*/
	static cancel(cause) {
		const p = new CancellablePromise(() => {});
		p.cancel(cause);
		return p;
	}
	/**
	* Creates a new CancellablePromise that cancels
	* after the specified timeout, with the provided cause.
	*
	* If the {@link AbortSignal.timeout} factory method is available,
	* it is used to base the timeout on _active_ time rather than _elapsed_ time.
	* Otherwise, `timeout` falls back to {@link setTimeout}.
	*
	* @group Static Methods
	*/
	static timeout(milliseconds, cause) {
		const promise = new CancellablePromise(() => {});
		if (AbortSignal && typeof AbortSignal === "function" && AbortSignal.timeout && typeof AbortSignal.timeout === "function") AbortSignal.timeout(milliseconds).addEventListener("abort", () => void promise.cancel(cause));
		else setTimeout(() => void promise.cancel(cause), milliseconds);
		return promise;
	}
	static sleep(milliseconds, value) {
		return new CancellablePromise((resolve) => {
			setTimeout(() => resolve(value), milliseconds);
		});
	}
	/**
	* Creates a new rejected CancellablePromise for the provided reason.
	*
	* @group Static Methods
	*/
	static reject(reason) {
		return new CancellablePromise((_, reject) => reject(reason));
	}
	static resolve(value) {
		if (value instanceof CancellablePromise) return value;
		return new CancellablePromise((resolve) => resolve(value));
	}
	/**
	* Creates a new CancellablePromise and returns it in an object, along with its resolve and reject functions
	* and a getter/setter for the cancellation callback.
	*
	* This method is polyfilled, hence available in every OS/webview version.
	*
	* @group Static Methods
	*/
	static withResolvers() {
		let result = { oncancelled: null };
		result.promise = new CancellablePromise((resolve, reject) => {
			result.resolve = resolve;
			result.reject = reject;
		}, (cause) => {
			var _a;
			(_a = result.oncancelled) === null || _a === void 0 || _a.call(result, cause);
		});
		return result;
	}
};
/**
* Returns a callback that implements the cancellation algorithm for the given cancellable promise.
* The promise returned from the resulting function does not reject.
*/
function cancellerFor(promise, state) {
	let cancellationPromise = void 0;
	return (reason) => {
		if (!state.settled) {
			state.settled = true;
			state.reason = reason;
			promise.reject(reason);
			Promise.prototype.then.call(promise.promise, void 0, (err) => {
				if (err !== reason) throw err;
			});
		}
		if (!state.reason || !promise.oncancelled) return;
		cancellationPromise = new Promise((resolve) => {
			try {
				resolve(promise.oncancelled(state.reason.cause));
			} catch (err) {
				Promise.reject(new CancelledRejectionError(promise.promise, err, "Unhandled exception in oncancelled callback."));
			}
		}).catch((reason) => {
			Promise.reject(new CancelledRejectionError(promise.promise, reason, "Unhandled rejection in oncancelled callback."));
		});
		promise.oncancelled = null;
		return cancellationPromise;
	};
}
/**
* Returns a callback that implements the resolution algorithm for the given cancellable promise.
*/
function resolverFor(promise, state) {
	return (value) => {
		if (state.resolving) return;
		state.resolving = true;
		if (value === promise.promise) {
			if (state.settled) return;
			state.settled = true;
			promise.reject(/* @__PURE__ */ new TypeError("A promise cannot be resolved with itself."));
			return;
		}
		if (value != null && (typeof value === "object" || typeof value === "function")) {
			let then;
			try {
				then = value.then;
			} catch (err) {
				state.settled = true;
				promise.reject(err);
				return;
			}
			if (callable_default(then)) {
				try {
					let cancel = value.cancel;
					if (callable_default(cancel)) {
						const oncancelled = (cause) => {
							Reflect.apply(cancel, value, [cause]);
						};
						if (state.reason) cancellerFor(Object.assign(Object.assign({}, promise), { oncancelled }), state)(state.reason);
						else promise.oncancelled = oncancelled;
					}
				} catch (_a) {}
				const newState = {
					root: state.root,
					resolving: false,
					get settled() {
						return this.root.settled;
					},
					set settled(value) {
						this.root.settled = value;
					},
					get reason() {
						return this.root.reason;
					}
				};
				const rejector = rejectorFor(promise, newState);
				try {
					Reflect.apply(then, value, [resolverFor(promise, newState), rejector]);
				} catch (err) {
					rejector(err);
				}
				return;
			}
		}
		if (state.settled) return;
		state.settled = true;
		promise.resolve(value);
	};
}
/**
* Returns a callback that implements the rejection algorithm for the given cancellable promise.
*/
function rejectorFor(promise, state) {
	return (reason) => {
		if (state.resolving) return;
		state.resolving = true;
		if (state.settled) {
			try {
				if (reason instanceof CancelError && state.reason instanceof CancelError && Object.is(reason.cause, state.reason.cause)) return;
			} catch (_a) {}
			Promise.reject(new CancelledRejectionError(promise.promise, reason));
		} else {
			state.settled = true;
			promise.reject(reason);
		}
	};
}
/**
* Cancels all values in an array that look like cancellable thenables.
* Returns a promise that fulfills once all cancellation procedures for the given values have settled.
*/
function cancelAll(parent, values, cause) {
	const results = [];
	for (const value of values) {
		let cancel;
		try {
			if (!callable_default(value.then)) continue;
			cancel = value.cancel;
			if (!callable_default(cancel)) continue;
		} catch (_a) {
			continue;
		}
		let result;
		try {
			result = Reflect.apply(cancel, value, [cause]);
		} catch (err) {
			Promise.reject(new CancelledRejectionError(parent, err, "Unhandled exception in cancel method."));
			continue;
		}
		if (!result) continue;
		results.push((result instanceof Promise ? result : Promise.resolve(result)).catch((reason) => {
			Promise.reject(new CancelledRejectionError(parent, reason, "Unhandled rejection in cancel method."));
		}));
	}
	return Promise.all(results);
}
/**
* Returns its argument.
*/
function identity(x) {
	return x;
}
/**
* Throws its argument.
*/
function thrower(reason) {
	throw reason;
}
/**
* Attempts various strategies to convert an error to a string.
*/
function errorMessage(err) {
	try {
		if (err instanceof Error || typeof err !== "object" || err.toString !== Object.prototype.toString) return "" + err;
	} catch (_a) {}
	try {
		return JSON.stringify(err);
	} catch (_b) {}
	try {
		return Object.prototype.toString.call(err);
	} catch (_c) {}
	return "<could not convert error to string>";
}
/**
* Gets the current barrier promise for the given cancellable promise. If necessary, initialises the barrier.
*/
function currentBarrier(promise) {
	var _a;
	let pwr = (_a = promise[barrierSym]) !== null && _a !== void 0 ? _a : {};
	if (!("promise" in pwr)) Object.assign(pwr, promiseWithResolvers());
	if (promise[barrierSym] == null) {
		pwr.resolve();
		promise[barrierSym] = pwr;
	}
	return pwr.promise;
}
var promiseWithResolvers = Promise.withResolvers;
if (promiseWithResolvers && typeof promiseWithResolvers === "function") promiseWithResolvers = promiseWithResolvers.bind(Promise);
else promiseWithResolvers = function() {
	let resolve;
	let reject;
	return {
		promise: new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		}),
		resolve,
		reject
	};
};
//#endregion
//#region node_modules/@wailsio/runtime/dist/calls.js
if (hasDOM) window._wails = window._wails || {};
var call = newRuntimeCaller(objectNames.Call);
var cancelCall = newRuntimeCaller(objectNames.CancelCall);
var callResponses = /* @__PURE__ */ new Map();
var CallBinding = 0;
var CancelMethod = 0;
/**
* Generates a unique ID using the nanoid library.
*
* @returns A unique ID that does not exist in the callResponses set.
*/
function generateID() {
	let result;
	do
		result = nanoid();
	while (callResponses.has(result));
	return result;
}
/**
* Call a bound method according to the given call options.
*
* In case of failure, the returned promise will reject with an exception
* among ReferenceError (unknown method), TypeError (wrong argument count or type),
* {@link RuntimeError} (method returned an error), or other (network or internal errors).
* The exception might have a "cause" field with the value returned
* by the application- or service-level error marshaling functions.
*
* @param options - A method call descriptor.
* @returns The result of the call.
*/
function Call(options) {
	const id = generateID();
	const result = CancellablePromise.withResolvers();
	callResponses.set(id, {
		resolve: result.resolve,
		reject: result.reject
	});
	const request = call(CallBinding, Object.assign({ "call-id": id }, options));
	let running = true;
	request.then((res) => {
		running = false;
		callResponses.delete(id);
		result.resolve(res);
	}, (err) => {
		running = false;
		callResponses.delete(id);
		result.reject(err);
	});
	const cancel = () => {
		callResponses.delete(id);
		return cancelCall(CancelMethod, { "call-id": id }).catch((err) => {
			console.error("Error while requesting binding call cancellation:", err);
		});
	};
	result.oncancelled = () => {
		if (running) return cancel();
		else return request.then(cancel);
	};
	return result.promise;
}
/**
* Calls a method by its numeric ID with the specified arguments.
* See {@link Call} for details.
*
* @param methodID - The ID of the method to call.
* @param args - The arguments to pass to the method.
* @return The result of the method call.
*/
function ByID(methodID, ...args) {
	return Call({
		methodID,
		args
	});
}
//#endregion
//#region node_modules/@wailsio/runtime/dist/create.js
/**
* Any is a dummy creation function for simple or unknown types.
*/
function Any(source) {
	return source;
}
/**
* Array takes a creation function for an arbitrary type
* and returns an in-place creation function for an array
* whose elements are of that type.
*/
function Array$1(element) {
	if (element === Any) return (source) => source === null ? [] : source;
	return (source) => {
		if (source === null) return [];
		for (let i = 0; i < source.length; i++) source[i] = element(source[i]);
		return source;
	};
}
/**
* Map takes creation functions for two arbitrary types
* and returns an in-place creation function for an object
* whose keys and values are of those types.
*/
function Map$1(key, value) {
	if (value === Any) return (source) => source === null ? {} : source;
	return (source) => {
		if (source === null) return {};
		for (const key in source) source[key] = value(source[key]);
		return source;
	};
}
/**
* Nullable takes a creation function for an arbitrary type
* and returns a creation function for a nullable value of that type.
*/
function Nullable(element) {
	if (element === Any) return Any;
	return (source) => source === null ? null : element(source);
}
/**
* Maps known event names to creation functions for their data types.
* Will be monkey-patched by the binding generator.
*/
var Events = {};
//#endregion
//#region node_modules/@wailsio/runtime/dist/window.js
var DROP_TARGET_ATTRIBUTE = "data-file-drop-target";
var DROP_TARGET_ACTIVE_CLASS = "file-drop-target-active";
var currentDropTarget = null;
var PositionMethod = 0;
var CenterMethod = 1;
var CloseMethod = 2;
var DisableSizeConstraintsMethod = 3;
var EnableSizeConstraintsMethod = 4;
var FocusMethod = 5;
var ForceReloadMethod = 6;
var FullscreenMethod = 7;
var GetScreenMethod = 8;
var GetZoomMethod = 9;
var HeightMethod = 10;
var HideMethod = 11;
var IsFocusedMethod = 12;
var IsFullscreenMethod = 13;
var IsMaximisedMethod = 14;
var IsMinimisedMethod = 15;
var MaximiseMethod = 16;
var MinimiseMethod = 17;
var NameMethod = 18;
var OpenDevToolsMethod = 19;
var RelativePositionMethod = 20;
var ReloadMethod = 21;
var ResizableMethod = 22;
var RestoreMethod = 23;
var SetPositionMethod = 24;
var SetAlwaysOnTopMethod = 25;
var SetBackgroundColourMethod = 26;
var SetFramelessMethod = 27;
var SetFullscreenButtonEnabledMethod = 28;
var SetMaxSizeMethod = 29;
var SetMinSizeMethod = 30;
var SetRelativePositionMethod = 31;
var SetResizableMethod = 32;
var SetSizeMethod = 33;
var SetTitleMethod = 34;
var SetZoomMethod = 35;
var ShowMethod = 36;
var SizeMethod = 37;
var ToggleFullscreenMethod = 38;
var ToggleMaximiseMethod = 39;
var ToggleFramelessMethod = 40;
var UnFullscreenMethod = 41;
var UnMaximiseMethod = 42;
var UnMinimiseMethod = 43;
var WidthMethod = 44;
var ZoomMethod = 45;
var ZoomInMethod = 46;
var ZoomOutMethod = 47;
var ZoomResetMethod = 48;
var SnapAssistMethod = 49;
var FilesDropped = 50;
var PrintMethod = 51;
var SetScreenMethod = 52;
/**
* Finds the nearest drop target element by walking up the DOM tree.
*/
function getDropTargetElement(element) {
	if (!element) return null;
	return element.closest(`[${DROP_TARGET_ATTRIBUTE}]`);
}
/**
* Check if we can use WebView2's postMessageWithAdditionalObjects (Windows)
* Also checks that EnableFileDrop is true for this window.
*/
function canResolveFilePaths() {
	var _a, _b, _c, _d;
	if (((_b = (_a = window.chrome) === null || _a === void 0 ? void 0 : _a.webview) === null || _b === void 0 ? void 0 : _b.postMessageWithAdditionalObjects) == null) return false;
	return ((_d = (_c = window._wails) === null || _c === void 0 ? void 0 : _c.flags) === null || _d === void 0 ? void 0 : _d.enableFileDrop) === true;
}
/**
* Send file drop to backend via WebView2 (Windows only)
*/
function resolveFilePaths(x, y, files) {
	var _a, _b;
	if ((_b = (_a = window.chrome) === null || _a === void 0 ? void 0 : _a.webview) === null || _b === void 0 ? void 0 : _b.postMessageWithAdditionalObjects) window.chrome.webview.postMessageWithAdditionalObjects(`file:drop:${x}:${y}`, files);
}
var nativeDragActive = false;
/**
* Cleans up native drag state and hover effects.
* Called on drop or when drag leaves the window.
*/
function cleanupNativeDrag() {
	nativeDragActive = false;
	if (currentDropTarget) {
		currentDropTarget.classList.remove(DROP_TARGET_ACTIVE_CLASS);
		currentDropTarget = null;
	}
}
/**
* Called from Go when a file drag enters the window on Linux/macOS.
*/
function handleDragEnter() {
	var _a, _b;
	if (((_b = (_a = window._wails) === null || _a === void 0 ? void 0 : _a.flags) === null || _b === void 0 ? void 0 : _b.enableFileDrop) === false) return;
	nativeDragActive = true;
}
/**
* Called from Go when a file drag leaves the window on Linux/macOS.
*/
function handleDragLeave() {
	cleanupNativeDrag();
}
/**
* Called from Go during file drag to update hover state on Linux/macOS.
* @param x - X coordinate in CSS pixels
* @param y - Y coordinate in CSS pixels
*/
function handleDragOver(x, y) {
	var _a, _b;
	if (!nativeDragActive) return;
	if (((_b = (_a = window._wails) === null || _a === void 0 ? void 0 : _a.flags) === null || _b === void 0 ? void 0 : _b.enableFileDrop) === false) return;
	const dropTarget = getDropTargetElement(document.elementFromPoint(x, y));
	if (currentDropTarget && currentDropTarget !== dropTarget) currentDropTarget.classList.remove(DROP_TARGET_ACTIVE_CLASS);
	if (dropTarget) {
		dropTarget.classList.add(DROP_TARGET_ACTIVE_CLASS);
		currentDropTarget = dropTarget;
	} else currentDropTarget = null;
}
var callerSym = Symbol("caller");
/**
* The window within which the script is running.
*/
var thisWindow = new class Window {
	/**
	* Initialises a window object with the specified name.
	*
	* @private
	* @param name - The name of the target window.
	*/
	constructor(name = "") {
		this[callerSym] = newRuntimeCaller(objectNames.Window, name);
		for (const method of Object.getOwnPropertyNames(Window.prototype)) if (method !== "constructor" && typeof this[method] === "function") this[method] = this[method].bind(this);
	}
	/**
	* Gets the specified window.
	*
	* @param name - The name of the window to get.
	* @returns The corresponding window object.
	*/
	Get(name) {
		return new Window(name);
	}
	/**
	* Returns the absolute position of the window.
	*
	* @returns The current absolute position of the window.
	*/
	Position() {
		return this[callerSym](PositionMethod);
	}
	/**
	* Centers the window on the screen.
	*/
	Center() {
		return this[callerSym](CenterMethod);
	}
	/**
	* Closes the window.
	*/
	Close() {
		return this[callerSym](CloseMethod);
	}
	/**
	* Disables min/max size constraints.
	*/
	DisableSizeConstraints() {
		return this[callerSym](DisableSizeConstraintsMethod);
	}
	/**
	* Enables min/max size constraints.
	*/
	EnableSizeConstraints() {
		return this[callerSym](EnableSizeConstraintsMethod);
	}
	/**
	* Focuses the window.
	*/
	Focus() {
		return this[callerSym](FocusMethod);
	}
	/**
	* Forces the window to reload the page assets.
	*/
	ForceReload() {
		return this[callerSym](ForceReloadMethod);
	}
	/**
	* Switches the window to fullscreen mode.
	*/
	Fullscreen() {
		return this[callerSym](FullscreenMethod);
	}
	/**
	* Returns the screen that the window is on.
	*
	* @returns The screen the window is currently on.
	*/
	GetScreen() {
		return this[callerSym](GetScreenMethod);
	}
	/**
	* Returns the current zoom level of the window.
	*
	* @returns The current zoom level.
	*/
	GetZoom() {
		return this[callerSym](GetZoomMethod);
	}
	/**
	* Returns the height of the window.
	*
	* @returns The current height of the window.
	*/
	Height() {
		return this[callerSym](HeightMethod);
	}
	/**
	* Hides the window.
	*/
	Hide() {
		return this[callerSym](HideMethod);
	}
	/**
	* Returns true if the window is focused.
	*
	* @returns Whether the window is currently focused.
	*/
	IsFocused() {
		return this[callerSym](IsFocusedMethod);
	}
	/**
	* Returns true if the window is fullscreen.
	*
	* @returns Whether the window is currently fullscreen.
	*/
	IsFullscreen() {
		return this[callerSym](IsFullscreenMethod);
	}
	/**
	* Returns true if the window is maximised.
	*
	* @returns Whether the window is currently maximised.
	*/
	IsMaximised() {
		return this[callerSym](IsMaximisedMethod);
	}
	/**
	* Returns true if the window is minimised.
	*
	* @returns Whether the window is currently minimised.
	*/
	IsMinimised() {
		return this[callerSym](IsMinimisedMethod);
	}
	/**
	* Maximises the window.
	*/
	Maximise() {
		return this[callerSym](MaximiseMethod);
	}
	/**
	* Minimises the window.
	*/
	Minimise() {
		return this[callerSym](MinimiseMethod);
	}
	/**
	* Returns the name of the window.
	*
	* @returns The name of the window.
	*/
	Name() {
		return this[callerSym](NameMethod);
	}
	/**
	* Opens the development tools pane.
	*/
	OpenDevTools() {
		return this[callerSym](OpenDevToolsMethod);
	}
	/**
	* Returns the relative position of the window to the screen.
	*
	* @returns The current relative position of the window.
	*/
	RelativePosition() {
		return this[callerSym](RelativePositionMethod);
	}
	/**
	* Reloads the page assets.
	*/
	Reload() {
		return this[callerSym](ReloadMethod);
	}
	/**
	* Returns true if the window is resizable.
	*
	* @returns Whether the window is currently resizable.
	*/
	Resizable() {
		return this[callerSym](ResizableMethod);
	}
	/**
	* Restores the window to its previous state if it was previously minimised, maximised or fullscreen.
	*/
	Restore() {
		return this[callerSym](RestoreMethod);
	}
	/**
	* Sets the absolute position of the window.
	*
	* @param x - The desired horizontal absolute position of the window.
	* @param y - The desired vertical absolute position of the window.
	*/
	SetPosition(x, y) {
		return this[callerSym](SetPositionMethod, {
			x,
			y
		});
	}
	/**
	* Sets the window to be always on top.
	*
	* @param alwaysOnTop - Whether the window should stay on top.
	*/
	SetAlwaysOnTop(alwaysOnTop) {
		return this[callerSym](SetAlwaysOnTopMethod, { alwaysOnTop });
	}
	/**
	* Sets the background colour of the window.
	*
	* @param r - The desired red component of the window background.
	* @param g - The desired green component of the window background.
	* @param b - The desired blue component of the window background.
	* @param a - The desired alpha component of the window background.
	*/
	SetBackgroundColour(r, g, b, a) {
		return this[callerSym](SetBackgroundColourMethod, {
			r,
			g,
			b,
			a
		});
	}
	/**
	* Removes the window frame and title bar.
	*
	* @param frameless - Whether the window should be frameless.
	*/
	SetFrameless(frameless) {
		return this[callerSym](SetFramelessMethod, { frameless });
	}
	/**
	* Disables the system fullscreen button.
	*
	* @param enabled - Whether the fullscreen button should be enabled.
	*/
	SetFullscreenButtonEnabled(enabled) {
		return this[callerSym](SetFullscreenButtonEnabledMethod, { enabled });
	}
	/**
	* Sets the maximum size of the window.
	*
	* @param width - The desired maximum width of the window.
	* @param height - The desired maximum height of the window.
	*/
	SetMaxSize(width, height) {
		return this[callerSym](SetMaxSizeMethod, {
			width,
			height
		});
	}
	/**
	* Sets the minimum size of the window.
	*
	* @param width - The desired minimum width of the window.
	* @param height - The desired minimum height of the window.
	*/
	SetMinSize(width, height) {
		return this[callerSym](SetMinSizeMethod, {
			width,
			height
		});
	}
	/**
	* Sets the relative position of the window to the screen.
	*
	* @param x - The desired horizontal relative position of the window.
	* @param y - The desired vertical relative position of the window.
	*/
	SetRelativePosition(x, y) {
		return this[callerSym](SetRelativePositionMethod, {
			x,
			y
		});
	}
	/**
	* Sets whether the window is resizable.
	*
	* @param resizable - Whether the window should be resizable.
	*/
	SetResizable(resizable) {
		return this[callerSym](SetResizableMethod, { resizable });
	}
	/**
	* Sets the size of the window.
	*
	* @param width - The desired width of the window.
	* @param height - The desired height of the window.
	*/
	SetSize(width, height) {
		return this[callerSym](SetSizeMethod, {
			width,
			height
		});
	}
	/**
	* Sets the title of the window.
	*
	* @param title - The desired title of the window.
	*/
	SetTitle(title) {
		return this[callerSym](SetTitleMethod, { title });
	}
	/**
	* Sets the zoom level of the window.
	*
	* @param zoom - The desired zoom level.
	*/
	SetZoom(zoom) {
		return this[callerSym](SetZoomMethod, { zoom });
	}
	/**
	* Shows the window.
	*/
	Show() {
		return this[callerSym](ShowMethod);
	}
	/**
	* Returns the size of the window.
	*
	* @returns The current size of the window.
	*/
	Size() {
		return this[callerSym](SizeMethod);
	}
	/**
	* Toggles the window between fullscreen and normal.
	*/
	ToggleFullscreen() {
		return this[callerSym](ToggleFullscreenMethod);
	}
	/**
	* Toggles the window between maximised and normal.
	*/
	ToggleMaximise() {
		return this[callerSym](ToggleMaximiseMethod);
	}
	/**
	* Toggles the window between frameless and normal.
	*/
	ToggleFrameless() {
		return this[callerSym](ToggleFramelessMethod);
	}
	/**
	* Un-fullscreens the window.
	*/
	UnFullscreen() {
		return this[callerSym](UnFullscreenMethod);
	}
	/**
	* Un-maximises the window.
	*/
	UnMaximise() {
		return this[callerSym](UnMaximiseMethod);
	}
	/**
	* Un-minimises the window.
	*/
	UnMinimise() {
		return this[callerSym](UnMinimiseMethod);
	}
	/**
	* Returns the width of the window.
	*
	* @returns The current width of the window.
	*/
	Width() {
		return this[callerSym](WidthMethod);
	}
	/**
	* Zooms the window.
	*/
	Zoom() {
		return this[callerSym](ZoomMethod);
	}
	/**
	* Increases the zoom level of the webview content.
	*/
	ZoomIn() {
		return this[callerSym](ZoomInMethod);
	}
	/**
	* Decreases the zoom level of the webview content.
	*/
	ZoomOut() {
		return this[callerSym](ZoomOutMethod);
	}
	/**
	* Resets the zoom level of the webview content.
	*/
	ZoomReset() {
		return this[callerSym](ZoomResetMethod);
	}
	/**
	* Handles file drops originating from platform-specific code (e.g., macOS/Linux native drag-and-drop).
	* Gathers information about the drop target element and sends it back to the Go backend.
	*
	* @param filenames - An array of file paths (strings) that were dropped.
	* @param x - The x-coordinate of the drop event, in logical (CSS) pixels relative to the webview.
	* @param y - The y-coordinate of the drop event, in logical (CSS) pixels relative to the webview.
	*/
	HandlePlatformFileDrop(filenames, x, y) {
		var _a, _b;
		if (((_b = (_a = window._wails) === null || _a === void 0 ? void 0 : _a.flags) === null || _b === void 0 ? void 0 : _b.enableFileDrop) === false) return;
		const dropTarget = getDropTargetElement(document.elementFromPoint(x, y));
		if (!dropTarget) return;
		const elementDetails = {
			id: dropTarget.id,
			classList: Array.from(dropTarget.classList),
			attributes: {}
		};
		for (let i = 0; i < dropTarget.attributes.length; i++) {
			const attr = dropTarget.attributes[i];
			elementDetails.attributes[attr.name] = attr.value;
		}
		const payload = {
			filenames,
			x,
			y,
			elementDetails
		};
		this[callerSym](FilesDropped, payload);
		cleanupNativeDrag();
	}
	/**
	* Moves the window to the center of the specified screen's work area.
	*
	* @param screenID - The ID of the target screen.
	*/
	SetScreen(screenID) {
		return this[callerSym](SetScreenMethod, { screenID });
	}
	SnapAssist() {
		return this[callerSym](SnapAssistMethod);
	}
	/**
	* Opens the print dialog for the window.
	*/
	Print() {
		return this[callerSym](PrintMethod);
	}
}("");
/**
* Sets up global drag and drop event listeners for file drops.
* Handles visual feedback (hover state) and file drop processing.
*/
function setupDropTargetListeners() {
	const docElement = document.documentElement;
	let dragEnterCounter = 0;
	docElement.addEventListener("dragenter", (event) => {
		var _a, _b, _c;
		if (!((_a = event.dataTransfer) === null || _a === void 0 ? void 0 : _a.types.includes("Files"))) return;
		event.preventDefault();
		if (((_c = (_b = window._wails) === null || _b === void 0 ? void 0 : _b.flags) === null || _c === void 0 ? void 0 : _c.enableFileDrop) === false) {
			event.dataTransfer.dropEffect = "none";
			return;
		}
		dragEnterCounter++;
		const dropTarget = getDropTargetElement(document.elementFromPoint(event.clientX, event.clientY));
		if (currentDropTarget && currentDropTarget !== dropTarget) currentDropTarget.classList.remove(DROP_TARGET_ACTIVE_CLASS);
		if (dropTarget) {
			dropTarget.classList.add(DROP_TARGET_ACTIVE_CLASS);
			event.dataTransfer.dropEffect = "copy";
			currentDropTarget = dropTarget;
		} else {
			event.dataTransfer.dropEffect = "none";
			currentDropTarget = null;
		}
	}, false);
	docElement.addEventListener("dragover", (event) => {
		var _a, _b, _c;
		if (!((_a = event.dataTransfer) === null || _a === void 0 ? void 0 : _a.types.includes("Files"))) return;
		event.preventDefault();
		if (((_c = (_b = window._wails) === null || _b === void 0 ? void 0 : _b.flags) === null || _c === void 0 ? void 0 : _c.enableFileDrop) === false) {
			event.dataTransfer.dropEffect = "none";
			return;
		}
		const dropTarget = getDropTargetElement(document.elementFromPoint(event.clientX, event.clientY));
		if (currentDropTarget && currentDropTarget !== dropTarget) currentDropTarget.classList.remove(DROP_TARGET_ACTIVE_CLASS);
		if (dropTarget) {
			if (!dropTarget.classList.contains(DROP_TARGET_ACTIVE_CLASS)) dropTarget.classList.add(DROP_TARGET_ACTIVE_CLASS);
			event.dataTransfer.dropEffect = "copy";
			currentDropTarget = dropTarget;
		} else {
			event.dataTransfer.dropEffect = "none";
			currentDropTarget = null;
		}
	}, false);
	docElement.addEventListener("dragleave", (event) => {
		var _a, _b, _c;
		if (!((_a = event.dataTransfer) === null || _a === void 0 ? void 0 : _a.types.includes("Files"))) return;
		event.preventDefault();
		if (((_c = (_b = window._wails) === null || _b === void 0 ? void 0 : _b.flags) === null || _c === void 0 ? void 0 : _c.enableFileDrop) === false) return;
		if (event.relatedTarget === null) return;
		dragEnterCounter--;
		if (dragEnterCounter === 0 || currentDropTarget && !currentDropTarget.contains(event.relatedTarget)) {
			if (currentDropTarget) {
				currentDropTarget.classList.remove(DROP_TARGET_ACTIVE_CLASS);
				currentDropTarget = null;
			}
			dragEnterCounter = 0;
		}
	}, false);
	docElement.addEventListener("drop", (event) => {
		var _a, _b, _c;
		if (!((_a = event.dataTransfer) === null || _a === void 0 ? void 0 : _a.types.includes("Files"))) return;
		event.preventDefault();
		if (((_c = (_b = window._wails) === null || _b === void 0 ? void 0 : _b.flags) === null || _c === void 0 ? void 0 : _c.enableFileDrop) === false) return;
		dragEnterCounter = 0;
		if (currentDropTarget) {
			currentDropTarget.classList.remove(DROP_TARGET_ACTIVE_CLASS);
			currentDropTarget = null;
		}
		if (canResolveFilePaths()) {
			const files = [];
			if (event.dataTransfer.items) {
				for (const item of event.dataTransfer.items) if (item.kind === "file") {
					const file = item.getAsFile();
					if (file) files.push(file);
				}
			} else if (event.dataTransfer.files) for (const file of event.dataTransfer.files) files.push(file);
			if (files.length > 0) resolveFilePaths(event.clientX, event.clientY, files);
		}
	}, false);
}
if (typeof window !== "undefined" && typeof document !== "undefined") setupDropTargetListeners();
//#endregion
//#region node_modules/@wailsio/runtime/dist/index.js
if (hasDOM) window._wails = window._wails || {};
if (hasDOM) {
	window._wails.invoke = invoke;
	window._wails.clientId = clientId;
}
if (hasDOM) window._wails.handlePlatformFileDrop = thisWindow.HandlePlatformFileDrop.bind(thisWindow);
if (hasDOM) {
	window._wails.handleDragEnter = handleDragEnter;
	window._wails.handleDragLeave = handleDragLeave;
	window._wails.handleDragOver = handleDragOver;
}
if (hasDOM) invoke("wails:runtime:ready");
/**
* Loads a script from the given URL if it exists.
* Uses HEAD request to check existence, then injects a script tag.
* Silently ignores if the script doesn't exist.
*/
function loadOptionalScript(url) {
	return fetch(url, { method: "HEAD" }).then((response) => {
		if (response.ok) {
			if ((response.headers.get("content-type") || "").toLowerCase().includes("javascript")) {
				const script = document.createElement("script");
				script.src = url;
				document.head.appendChild(script);
			}
		}
	}).catch(() => {});
}
if (hasDOM) loadOptionalScript("/wails/custom.js");
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/container/models.js
var Container = class Container {
	/**
	* Creates a new Container instance.
	* @param {Partial<Container>} [$$source = {}] - The source object to create the Container.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("image" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["image"] = "";
		if (!("state" in $$source))
 /**
		* running / exited / paused / ...
		* @member
		* @type {string}
		*/
		this["state"] = "";
		if (!("status" in $$source))
 /**
		* 人类可读，如 "Up 5 days"
		* @member
		* @type {string}
		*/
		this["status"] = "";
		if (!("ports" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["ports"] = "";
		if (!("createdAt" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["createdAt"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new Container instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {Container}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new Container($$parsedSource);
	}
};
var ContainerDetail = class ContainerDetail {
	/**
	* Creates a new ContainerDetail instance.
	* @param {Partial<ContainerDetail>} [$$source = {}] - The source object to create the ContainerDetail.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("image" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["image"] = "";
		if (!("state" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["state"] = "";
		if (!("status" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["status"] = "";
		if (!("startedAt" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["startedAt"] = "";
		if (!("finishedAt" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["finishedAt"] = "";
		if (!("exitCode" in $$source))
 /**
		* @member
		* @type {number | null}
		*/
		this["exitCode"] = null;
		if (!("oomKilled" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["oomKilled"] = false;
		if (!("pid" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["pid"] = 0;
		if (!("restartPolicy" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["restartPolicy"] = "";
		if (!("entrypoint" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["entrypoint"] = "";
		if (!("command" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["command"] = "";
		if (!("workDir" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["workDir"] = "";
		if (!("user" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["user"] = "";
		if (!("networkMode" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["networkMode"] = "";
		if (!("ip" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["ip"] = "";
		if (!("gateway" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["gateway"] = "";
		if (!("ports" in $$source))
 /**
		* @member
		* @type {PortMapping[]}
		*/
		this["ports"] = [];
		if (!("mounts" in $$source))
 /**
		* @member
		* @type {Mount[]}
		*/
		this["mounts"] = [];
		if (!("env" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["env"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ContainerDetail instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ContainerDetail}
	*/
	static createFrom($$source = {}) {
		const $$createField18_0 = $$createType1$6;
		const $$createField19_0 = $$createType3$5;
		const $$createField20_0 = $$createType4$5;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("ports" in $$parsedSource) $$parsedSource["ports"] = $$createField18_0($$parsedSource["ports"]);
		if ("mounts" in $$parsedSource) $$parsedSource["mounts"] = $$createField19_0($$parsedSource["mounts"]);
		if ("env" in $$parsedSource) $$parsedSource["env"] = $$createField20_0($$parsedSource["env"]);
		return new ContainerDetail($$parsedSource);
	}
};
var Image = class Image {
	/**
	* Creates a new Image instance.
	* @param {Partial<Image>} [$$source = {}] - The source object to create the Image.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("repository" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["repository"] = "";
		if (!("tag" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["tag"] = "";
		if (!("size" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["size"] = "";
		if (!("createdAt" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["createdAt"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new Image instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {Image}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new Image($$parsedSource);
	}
};
/**
* InspectResult: 归一化详情 + inspect 原文（前端 JSON tab 展示用）
*/
var InspectResult = class InspectResult {
	/**
	* Creates a new InspectResult instance.
	* @param {Partial<InspectResult>} [$$source = {}] - The source object to create the InspectResult.
	*/
	constructor($$source = {}) {
		if (!("detail" in $$source))
 /**
		* @member
		* @type {ContainerDetail}
		*/
		this["detail"] = new ContainerDetail();
		if (!("raw" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["raw"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new InspectResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {InspectResult}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType5$4;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("detail" in $$parsedSource) $$parsedSource["detail"] = $$createField0_0($$parsedSource["detail"]);
		return new InspectResult($$parsedSource);
	}
};
var Mount = class Mount {
	/**
	* Creates a new Mount instance.
	* @param {Partial<Mount>} [$$source = {}] - The source object to create the Mount.
	*/
	constructor($$source = {}) {
		if (!("source" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["source"] = "";
		if (!("destination" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["destination"] = "";
		if (!("rw" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["rw"] = false;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new Mount instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {Mount}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new Mount($$parsedSource);
	}
};
var PortMapping = class PortMapping {
	/**
	* Creates a new PortMapping instance.
	* @param {Partial<PortMapping>} [$$source = {}] - The source object to create the PortMapping.
	*/
	constructor($$source = {}) {
		if (!("hostPort" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["hostPort"] = "";
		if (!("containerPort" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["containerPort"] = "";
		if (!("protocol" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["protocol"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new PortMapping instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {PortMapping}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new PortMapping($$parsedSource);
	}
};
var Stats = class Stats {
	/**
	* Creates a new Stats instance.
	* @param {Partial<Stats>} [$$source = {}] - The source object to create the Stats.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("cpuPercent" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["cpuPercent"] = "";
		if (!("memUsage" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["memUsage"] = "";
		if (!("memPercent" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["memPercent"] = "";
		if (!("netIO" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["netIO"] = "";
		if (!("blockIO" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["blockIO"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new Stats instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {Stats}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new Stats($$parsedSource);
	}
};
var $$createType0$6 = PortMapping.createFrom;
var $$createType1$6 = Array$1($$createType0$6);
var $$createType2$5 = Mount.createFrom;
var $$createType3$5 = Array$1($$createType2$5);
var $$createType4$5 = Array$1(Any);
var $$createType5$4 = ContainerDetail.createFrom;
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/database/models.js
var ColumnInfo = class ColumnInfo {
	/**
	* Creates a new ColumnInfo instance.
	* @param {Partial<ColumnInfo>} [$$source = {}] - The source object to create the ColumnInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("type" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["type"] = "";
		if (!("nullable" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["nullable"] = false;
		if (!("defaultVal" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["defaultVal"] = "";
		if (!("defaultType" in $$source))
 /**
		* "none" | "null" | "value" | "auto"
		* @member
		* @type {string}
		*/
		this["defaultType"] = "";
		if (!("isPrimary" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["isPrimary"] = false;
		if (!("comment" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["comment"] = "";
		if (!("collation" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["collation"] = "";
		if (!("onUpdate" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["onUpdate"] = false;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ColumnInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ColumnInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new ColumnInfo($$parsedSource);
	}
};
/**
* DBCapabilities describes the features supported by a database type.
* Providers return only the fields they override; unset fields use defaults.
* @typedef {{ [_ in string]?: any }} DBCapabilities
*/
var ExecResult = class ExecResult {
	/**
	* Creates a new ExecResult instance.
	* @param {Partial<ExecResult>} [$$source = {}] - The source object to create the ExecResult.
	*/
	constructor($$source = {}) {
		if (!("affected" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["affected"] = 0;
		if (!("lastInsertId" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["lastInsertId"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ExecResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ExecResult}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new ExecResult($$parsedSource);
	}
};
var IndexInfo = class IndexInfo {
	/**
	* Creates a new IndexInfo instance.
	* @param {Partial<IndexInfo>} [$$source = {}] - The source object to create the IndexInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("columns" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["columns"] = [];
		if (!("unique" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["unique"] = false;
		if (!("isPrimary" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["isPrimary"] = false;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new IndexInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {IndexInfo}
	*/
	static createFrom($$source = {}) {
		const $$createField1_0 = $$createType0$5;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("columns" in $$parsedSource) $$parsedSource["columns"] = $$createField1_0($$parsedSource["columns"]);
		return new IndexInfo($$parsedSource);
	}
};
var QueryResult = class QueryResult {
	/**
	* Creates a new QueryResult instance.
	* @param {Partial<QueryResult>} [$$source = {}] - The source object to create the QueryResult.
	*/
	constructor($$source = {}) {
		if (!("columns" in $$source))
 /**
		* @member
		* @type {QueryResultColumn[]}
		*/
		this["columns"] = [];
		if (!("rows" in $$source))
 /**
		* @member
		* @type {{ [_ in string]?: any }[]}
		*/
		this["rows"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new QueryResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {QueryResult}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType2$4;
		const $$createField1_0 = $$createType4$4;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("columns" in $$parsedSource) $$parsedSource["columns"] = $$createField0_0($$parsedSource["columns"]);
		if ("rows" in $$parsedSource) $$parsedSource["rows"] = $$createField1_0($$parsedSource["rows"]);
		return new QueryResult($$parsedSource);
	}
};
var QueryResultColumn = class QueryResultColumn {
	/**
	* Creates a new QueryResultColumn instance.
	* @param {Partial<QueryResultColumn>} [$$source = {}] - The source object to create the QueryResultColumn.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("type" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["type"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new QueryResultColumn instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {QueryResultColumn}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new QueryResultColumn($$parsedSource);
	}
};
var SchemaResult = class SchemaResult {
	/**
	* Creates a new SchemaResult instance.
	* @param {Partial<SchemaResult>} [$$source = {}] - The source object to create the SchemaResult.
	*/
	constructor($$source = {}) {
		if (!("columns" in $$source))
 /**
		* @member
		* @type {ColumnInfo[]}
		*/
		this["columns"] = [];
		if (!("indexes" in $$source))
 /**
		* @member
		* @type {IndexInfo[]}
		*/
		this["indexes"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new SchemaResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {SchemaResult}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType6$3;
		const $$createField1_0 = $$createType8$3;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("columns" in $$parsedSource) $$parsedSource["columns"] = $$createField0_0($$parsedSource["columns"]);
		if ("indexes" in $$parsedSource) $$parsedSource["indexes"] = $$createField1_0($$parsedSource["indexes"]);
		return new SchemaResult($$parsedSource);
	}
};
/**
* ScriptResult is the outcome of running a multi-statement SQL script.
*/
var ScriptResult = class ScriptResult {
	/**
	* Creates a new ScriptResult instance.
	* @param {Partial<ScriptResult>} [$$source = {}] - The source object to create the ScriptResult.
	*/
	constructor($$source = {}) {
		if (!("executed" in $$source))
 /**
		* statements that ran successfully
		* @member
		* @type {number}
		*/
		this["executed"] = 0;
		if (!("failedLine" in $$source))
 /**
		* 1-based line of the failing statement; 0 if all ok
		* @member
		* @type {number}
		*/
		this["failedLine"] = 0;
		if (!("failedSql" in $$source))
 /**
		* the failing statement (truncated for display)
		* @member
		* @type {string}
		*/
		this["failedSql"] = "";
		if (!("error" in $$source))
 /**
		* failure message
		* @member
		* @type {string}
		*/
		this["error"] = "";
		if (!("affectedTotal" in $$source))
 /**
		* sum of rows affected across statements
		* @member
		* @type {number}
		*/
		this["affectedTotal"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ScriptResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ScriptResult}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new ScriptResult($$parsedSource);
	}
};
var TableInfo = class TableInfo {
	/**
	* Creates a new TableInfo instance.
	* @param {Partial<TableInfo>} [$$source = {}] - The source object to create the TableInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("type" in $$source))
 /**
		* "table" or "view"
		* @member
		* @type {string}
		*/
		this["type"] = "";
		if (!("comment" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["comment"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new TableInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {TableInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new TableInfo($$parsedSource);
	}
};
var $$createType0$5 = Array$1(Any);
var $$createType1$5 = QueryResultColumn.createFrom;
var $$createType2$4 = Array$1($$createType1$5);
var $$createType4$4 = Array$1(Map$1(Any, Any));
var $$createType5$3 = ColumnInfo.createFrom;
var $$createType6$3 = Array$1($$createType5$3);
var $$createType7$3 = IndexInfo.createFrom;
var $$createType8$3 = Array$1($$createType7$3);
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/session/models.js
var ConnectionConfig = class ConnectionConfig {
	/**
	* Creates a new ConnectionConfig instance.
	* @param {Partial<ConnectionConfig>} [$$source = {}] - The source object to create the ConnectionConfig.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("type" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["type"] = "";
		if (!("host" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["host"] = "";
		if (!("port" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["port"] = 0;
		if (!("user" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["user"] = "";
		if (!("authType" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["authType"] = "";
		if (!("rdpSmartSizing" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["rdpSmartSizing"] = false;
		if (!("rdpEnableNLA" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["rdpEnableNLA"] = false;
		if (!("rdpAdminSession" in $$source))
 /**
		* RdpAdminSession connects to the remote console (admin) session, the
		* equivalent of "mstsc /admin". Mapped to the ActiveX
		* IMsRdpClientAdvancedSettings8::ConnectToAdministerServer property.
		* @member
		* @type {boolean}
		*/
		this["rdpAdminSession"] = false;
		if (!("ftpPassive" in $$source))
 /**
		* passive mode (default true)
		* @member
		* @type {boolean}
		*/
		this["ftpPassive"] = false;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ConnectionConfig instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ConnectionConfig}
	*/
	static createFrom($$source = {}) {
		const $$createField39_0 = $$createType1$4;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("postLoginExpectSteps" in $$parsedSource) $$parsedSource["postLoginExpectSteps"] = $$createField39_0($$parsedSource["postLoginExpectSteps"]);
		return new ConnectionConfig($$parsedSource);
	}
};
var ConnectionGroup = class ConnectionGroup {
	/**
	* Creates a new ConnectionGroup instance.
	* @param {Partial<ConnectionGroup>} [$$source = {}] - The source object to create the ConnectionGroup.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ConnectionGroup instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ConnectionGroup}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new ConnectionGroup($$parsedSource);
	}
};
/**
* ConnectionStoreData is the top-level structure persisted to connections.json.
*/
var ConnectionStoreData = class ConnectionStoreData {
	/**
	* Creates a new ConnectionStoreData instance.
	* @param {Partial<ConnectionStoreData>} [$$source = {}] - The source object to create the ConnectionStoreData.
	*/
	constructor($$source = {}) {
		if (!("groups" in $$source))
 /**
		* @member
		* @type {ConnectionGroup[]}
		*/
		this["groups"] = [];
		if (!("connections" in $$source))
 /**
		* @member
		* @type {ConnectionConfig[]}
		*/
		this["connections"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ConnectionStoreData instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ConnectionStoreData}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType3$3;
		const $$createField1_0 = $$createType5$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("groups" in $$parsedSource) $$parsedSource["groups"] = $$createField0_0($$parsedSource["groups"]);
		if ("connections" in $$parsedSource) $$parsedSource["connections"] = $$createField1_0($$parsedSource["connections"]);
		return new ConnectionStoreData($$parsedSource);
	}
};
/**
* DeviceInfo is one row of the hardware devices tab. lshw is the primary
* source (PCI + USB + NVMe disks); lspci is the fallback (PCI only). Category
* is a display grouping key ("processor", "memory", "storage", "network",
* "display", "bus", "other") localized in the frontend.
*/
var DeviceInfo = class DeviceInfo {
	/**
	* Creates a new DeviceInfo instance.
	* @param {Partial<DeviceInfo>} [$$source = {}] - The source object to create the DeviceInfo.
	*/
	constructor($$source = {}) {
		if (!("category" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["category"] = "";
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("class" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["class"] = "";
		if (!("vendor" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["vendor"] = "";
		if (!("product" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["product"] = "";
		if (!("driver" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["driver"] = "";
		if (!("serial" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["serial"] = "";
		if (!("capacity" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["capacity"] = "";
		if (!("rev" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["rev"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new DeviceInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {DeviceInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new DeviceInfo($$parsedSource);
	}
};
var DiskInfo = class DiskInfo {
	/**
	* Creates a new DiskInfo instance.
	* @param {Partial<DiskInfo>} [$$source = {}] - The source object to create the DiskInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("type" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["type"] = "";
		if (!("size" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["size"] = "";
		if (!("mountPoint" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["mountPoint"] = "";
		if (!("used" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["used"] = "";
		if (!("total" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["total"] = "";
		if (!("usage" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["usage"] = 0;
		if (!("media" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["media"] = "";
		if (!("fsType" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["fsType"] = "";
		if (!("uuid" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["uuid"] = "";
		if (!("vendor" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["vendor"] = "";
		if (!("model" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["model"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new DiskInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {DiskInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new DiskInfo($$parsedSource);
	}
};
/**
* EsClusterHealth is a trimmed _cluster/health payload.
*/
var EsClusterHealth$1 = class EsClusterHealth$1 {
	/**
	* Creates a new EsClusterHealth instance.
	* @param {Partial<EsClusterHealth>} [$$source = {}] - The source object to create the EsClusterHealth.
	*/
	constructor($$source = {}) {
		if (!("clusterName" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["clusterName"] = "";
		if (!("status" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["status"] = "";
		if (!("numberOfNodes" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["numberOfNodes"] = 0;
		if (!("numberOfDataNodes" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["numberOfDataNodes"] = 0;
		if (!("activePrimaryShards" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["activePrimaryShards"] = 0;
		if (!("activeShards" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["activeShards"] = 0;
		if (!("relocatingShards" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["relocatingShards"] = 0;
		if (!("initializingShards" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["initializingShards"] = 0;
		if (!("unassignedShards" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["unassignedShards"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new EsClusterHealth instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {EsClusterHealth}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new EsClusterHealth$1($$parsedSource);
	}
};
/**
* EsClusterInfo is a trimmed GET / response.
*/
var EsClusterInfo$1 = class EsClusterInfo$1 {
	/**
	* Creates a new EsClusterInfo instance.
	* @param {Partial<EsClusterInfo>} [$$source = {}] - The source object to create the EsClusterInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("clusterName" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["clusterName"] = "";
		if (!("clusterUUID" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["clusterUUID"] = "";
		if (!("version" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["version"] = "";
		if (!("tagline" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["tagline"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new EsClusterInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {EsClusterInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new EsClusterInfo$1($$parsedSource);
	}
};
/**
* EsIndexInfo holds cat/indices row fields used by the UI.
*/
var EsIndexInfo = class EsIndexInfo {
	/**
	* Creates a new EsIndexInfo instance.
	* @param {Partial<EsIndexInfo>} [$$source = {}] - The source object to create the EsIndexInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("health" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["health"] = "";
		if (!("status" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["status"] = "";
		if (!("docsCount" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["docsCount"] = 0;
		if (!("storeSize" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["storeSize"] = "";
		if (!("pri" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["pri"] = 0;
		if (!("rep" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["rep"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new EsIndexInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {EsIndexInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new EsIndexInfo($$parsedSource);
	}
};
/**
* EsNodeSummary is a trimmed cat/nodes row.
*/
var EsNodeSummary = class EsNodeSummary {
	/**
	* Creates a new EsNodeSummary instance.
	* @param {Partial<EsNodeSummary>} [$$source = {}] - The source object to create the EsNodeSummary.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("ip" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["ip"] = "";
		if (!("nodeRole" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["nodeRole"] = "";
		if (!("heapPercent" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["heapPercent"] = "";
		if (!("ramPercent" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["ramPercent"] = "";
		if (!("cpu" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["cpu"] = "";
		if (!("load1m" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["load1m"] = "";
		if (!("master" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["master"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new EsNodeSummary instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {EsNodeSummary}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new EsNodeSummary($$parsedSource);
	}
};
/**
* EsRestResult is the generic REST console response.
*/
var EsRestResult = class EsRestResult {
	/**
	* Creates a new EsRestResult instance.
	* @param {Partial<EsRestResult>} [$$source = {}] - The source object to create the EsRestResult.
	*/
	constructor($$source = {}) {
		if (!("status" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["status"] = 0;
		if (!("body" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["body"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new EsRestResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {EsRestResult}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new EsRestResult($$parsedSource);
	}
};
/**
* EsSearchResult holds search hits as raw JSON source documents (with _id/_index/_score injected).
*/
var EsSearchResult = class EsSearchResult {
	/**
	* Creates a new EsSearchResult instance.
	* @param {Partial<EsSearchResult>} [$$source = {}] - The source object to create the EsSearchResult.
	*/
	constructor($$source = {}) {
		if (!("hits" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["hits"] = [];
		if (!("total" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["total"] = 0;
		if (!("from" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["from"] = 0;
		if (!("size" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["size"] = 0;
		if (!("took" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["took"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new EsSearchResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {EsSearchResult}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType6$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("hits" in $$parsedSource) $$parsedSource["hits"] = $$createField0_0($$parsedSource["hits"]);
		return new EsSearchResult($$parsedSource);
	}
};
/**
* FieldEntry represents a hash field-value pair.
*/
var FieldEntry = class FieldEntry {
	/**
	* Creates a new FieldEntry instance.
	* @param {Partial<FieldEntry>} [$$source = {}] - The source object to create the FieldEntry.
	*/
	constructor($$source = {}) {
		if (!("field" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["field"] = "";
		if (!("value" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["value"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new FieldEntry instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {FieldEntry}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new FieldEntry($$parsedSource);
	}
};
/**
* FileItem represents a file entry returned to the frontend.
*/
var FileItem = class FileItem {
	/**
	* Creates a new FileItem instance.
	* @param {Partial<FileItem>} [$$source = {}] - The source object to create the FileItem.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("size" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["size"] = 0;
		if (!("modTime" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["modTime"] = "";
		if (!("mode" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["mode"] = "";
		if (!("isDir" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["isDir"] = false;
		if (!("isHidden" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["isHidden"] = false;
		if (!("owner" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["owner"] = "";
		if (!("group" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["group"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new FileItem instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {FileItem}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new FileItem($$parsedSource);
	}
};
/**
* FileListResult wraps files + current directory for a list response.
*/
var FileListResult = class FileListResult {
	/**
	* Creates a new FileListResult instance.
	* @param {Partial<FileListResult>} [$$source = {}] - The source object to create the FileListResult.
	*/
	constructor($$source = {}) {
		if (!("files" in $$source))
 /**
		* @member
		* @type {FileItem[]}
		*/
		this["files"] = [];
		if (!("dir" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["dir"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new FileListResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {FileListResult}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType8$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("files" in $$parsedSource) $$parsedSource["files"] = $$createField0_0($$parsedSource["files"]);
		return new FileListResult($$parsedSource);
	}
};
var FruInfo = class FruInfo {
	/**
	* Creates a new FruInfo instance.
	* @param {Partial<FruInfo>} [$$source = {}] - The source object to create the FruInfo.
	*/
	constructor($$source = {}) {
		if (!("product" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["product"] = "";
		if (!("manufacturer" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["manufacturer"] = "";
		if (!("serial" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["serial"] = "";
		if (!("partNumber" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["partNumber"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new FruInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {FruInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new FruInfo($$parsedSource);
	}
};
/**
* HardwareSensors is the readings half: IPMI sensor list.
*/
var HardwareSensors = class HardwareSensors {
	/**
	* Creates a new HardwareSensors instance.
	* @param {Partial<HardwareSensors>} [$$source = {}] - The source object to create the HardwareSensors.
	*/
	constructor($$source = {}) {
		if (!("sensors" in $$source))
 /**
		* @member
		* @type {SensorInfo[]}
		*/
		this["sensors"] = [];
		if (!("hasIpmi" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["hasIpmi"] = false;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new HardwareSensors instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {HardwareSensors}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType10$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("sensors" in $$parsedSource) $$parsedSource["sensors"] = $$createField0_0($$parsedSource["sensors"]);
		return new HardwareSensors($$parsedSource);
	}
};
/**
* Identity 是一个可复用的登录凭证，存于 identities.json。
*/
var Identity = class Identity {
	/**
	* Creates a new Identity instance.
	* @param {Partial<Identity>} [$$source = {}] - The source object to create the Identity.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("username" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["username"] = "";
		if (!("authType" in $$source))
 /**
		* "password" | "key" | "keyText"
		* @member
		* @type {string}
		*/
		this["authType"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new Identity instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {Identity}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new Identity($$parsedSource);
	}
};
/**
* IdentityStoreData 是 identities.json 的顶层结构。
*/
var IdentityStoreData = class IdentityStoreData {
	/**
	* Creates a new IdentityStoreData instance.
	* @param {Partial<IdentityStoreData>} [$$source = {}] - The source object to create the IdentityStoreData.
	*/
	constructor($$source = {}) {
		if (!("identities" in $$source))
 /**
		* @member
		* @type {Identity[]}
		*/
		this["identities"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new IdentityStoreData instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {IdentityStoreData}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType12$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("identities" in $$parsedSource) $$parsedSource["identities"] = $$createField0_0($$parsedSource["identities"]);
		return new IdentityStoreData($$parsedSource);
	}
};
/**
* LanField is one ordered key/value row of `ipmitool lan print` output.
*/
var LanField = class LanField {
	/**
	* Creates a new LanField instance.
	* @param {Partial<LanField>} [$$source = {}] - The source object to create the LanField.
	*/
	constructor($$source = {}) {
		if (!("key" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["key"] = "";
		if (!("value" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["value"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new LanField instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {LanField}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new LanField($$parsedSource);
	}
};
/**
* MongoIndexInfo holds metadata for a MongoDB index.
*/
var MongoIndexInfo = class MongoIndexInfo {
	/**
	* Creates a new MongoIndexInfo instance.
	* @param {Partial<MongoIndexInfo>} [$$source = {}] - The source object to create the MongoIndexInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("keys" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["keys"] = [];
		if (!("type" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["type"] = "";
		if (!("unique" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["unique"] = false;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new MongoIndexInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {MongoIndexInfo}
	*/
	static createFrom($$source = {}) {
		const $$createField1_0 = $$createType6$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("keys" in $$parsedSource) $$parsedSource["keys"] = $$createField1_0($$parsedSource["keys"]);
		return new MongoIndexInfo($$parsedSource);
	}
};
/**
* MongoQueryResult holds paginated find results as raw JSON documents.
*/
var MongoQueryResult = class MongoQueryResult {
	/**
	* Creates a new MongoQueryResult instance.
	* @param {Partial<MongoQueryResult>} [$$source = {}] - The source object to create the MongoQueryResult.
	*/
	constructor($$source = {}) {
		if (!("documents" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["documents"] = [];
		if (!("total" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["total"] = 0;
		if (!("skip" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["skip"] = 0;
		if (!("limit" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["limit"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new MongoQueryResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {MongoQueryResult}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType6$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("documents" in $$parsedSource) $$parsedSource["documents"] = $$createField0_0($$parsedSource["documents"]);
		return new MongoQueryResult($$parsedSource);
	}
};
var NetCardInfo = class NetCardInfo {
	/**
	* Creates a new NetCardInfo instance.
	* @param {Partial<NetCardInfo>} [$$source = {}] - The source object to create the NetCardInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("state" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["state"] = "";
		if (!("mac" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["mac"] = "";
		if (!("speed" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["speed"] = "";
		if (!("type" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["type"] = "";
		if (!("bondMaster" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["bondMaster"] = "";
		if (!("bondSlaves" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["bondSlaves"] = [];
		if (!("ipAddrs" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["ipAddrs"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new NetCardInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {NetCardInfo}
	*/
	static createFrom($$source = {}) {
		const $$createField6_0 = $$createType6$2;
		const $$createField7_0 = $$createType6$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("bondSlaves" in $$parsedSource) $$parsedSource["bondSlaves"] = $$createField6_0($$parsedSource["bondSlaves"]);
		if ("ipAddrs" in $$parsedSource) $$parsedSource["ipAddrs"] = $$createField7_0($$parsedSource["ipAddrs"]);
		return new NetCardInfo($$parsedSource);
	}
};
var PortInfo = class PortInfo {
	/**
	* Creates a new PortInfo instance.
	* @param {Partial<PortInfo>} [$$source = {}] - The source object to create the PortInfo.
	*/
	constructor($$source = {}) {
		if (!("protocol" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["protocol"] = "";
		if (!("localAddr" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["localAddr"] = "";
		if (!("state" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["state"] = "";
		if (!("process" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["process"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new PortInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {PortInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new PortInfo($$parsedSource);
	}
};
var PostLoginExpectStep = class PostLoginExpectStep {
	/**
	* Creates a new PostLoginExpectStep instance.
	* @param {Partial<PostLoginExpectStep>} [$$source = {}] - The source object to create the PostLoginExpectStep.
	*/
	constructor($$source = {}) {
		if (!("expect" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["expect"] = "";
		if (!("send" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["send"] = "";
		if (!("enter" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["enter"] = false;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new PostLoginExpectStep instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {PostLoginExpectStep}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new PostLoginExpectStep($$parsedSource);
	}
};
/**
* Proxy is a reusable outbound proxy (SOCKS5/HTTP) stored in proxies.json,
* mirroring Identity in the credential vault. Pass is decrypted in memory and
* encrypted at rest. Enabled is a tri-state: nil (missing in old JSON) counts
* as enabled so existing stores keep working after upgrade.
*/
var Proxy = class Proxy {
	/**
	* Creates a new Proxy instance.
	* @param {Partial<Proxy>} [$$source = {}] - The source object to create the Proxy.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("kind" in $$source))
 /**
		* "socks5" | "http"
		* @member
		* @type {string}
		*/
		this["kind"] = "";
		if (!("host" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["host"] = "";
		if (!("port" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["port"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new Proxy instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {Proxy}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new Proxy($$parsedSource);
	}
};
/**
* ProxyStoreData is the top-level shape of proxies.json.
*/
var ProxyStoreData = class ProxyStoreData {
	/**
	* Creates a new ProxyStoreData instance.
	* @param {Partial<ProxyStoreData>} [$$source = {}] - The source object to create the ProxyStoreData.
	*/
	constructor($$source = {}) {
		if (!("proxies" in $$source))
 /**
		* @member
		* @type {Proxy[]}
		*/
		this["proxies"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ProxyStoreData instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ProxyStoreData}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType14$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("proxies" in $$parsedSource) $$parsedSource["proxies"] = $$createField0_0($$parsedSource["proxies"]);
		return new ProxyStoreData($$parsedSource);
	}
};
/**
* RedisKeyInfo holds metadata for a single Redis key.
*/
var RedisKeyInfo = class RedisKeyInfo {
	/**
	* Creates a new RedisKeyInfo instance.
	* @param {Partial<RedisKeyInfo>} [$$source = {}] - The source object to create the RedisKeyInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("type" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["type"] = "";
		if (!("ttl" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["ttl"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new RedisKeyInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {RedisKeyInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new RedisKeyInfo($$parsedSource);
	}
};
/**
* ScanResult holds a page of SCAN results with cursor for pagination.
*/
var ScanResult = class ScanResult {
	/**
	* Creates a new ScanResult instance.
	* @param {Partial<ScanResult>} [$$source = {}] - The source object to create the ScanResult.
	*/
	constructor($$source = {}) {
		if (!("keys" in $$source))
 /**
		* @member
		* @type {RedisKeyInfo[]}
		*/
		this["keys"] = [];
		if (!("cursor" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["cursor"] = 0;
		if (!("scanCount" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["scanCount"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ScanResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ScanResult}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType16$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("keys" in $$parsedSource) $$parsedSource["keys"] = $$createField0_0($$parsedSource["keys"]);
		return new ScanResult($$parsedSource);
	}
};
/**
* ScoredMember represents a sorted-set member with its score.
*/
var ScoredMember = class ScoredMember {
	/**
	* Creates a new ScoredMember instance.
	* @param {Partial<ScoredMember>} [$$source = {}] - The source object to create the ScoredMember.
	*/
	constructor($$source = {}) {
		if (!("score" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["score"] = 0;
		if (!("member" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["member"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ScoredMember instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ScoredMember}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new ScoredMember($$parsedSource);
	}
};
var SensorInfo = class SensorInfo {
	/**
	* Creates a new SensorInfo instance.
	* @param {Partial<SensorInfo>} [$$source = {}] - The source object to create the SensorInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("value" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["value"] = "";
		if (!("unit" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["unit"] = "";
		if (!("status" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["status"] = "";
		if (!("source" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["source"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new SensorInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {SensorInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new SensorInfo($$parsedSource);
	}
};
var ServiceInfo = class ServiceInfo {
	/**
	* Creates a new ServiceInfo instance.
	* @param {Partial<ServiceInfo>} [$$source = {}] - The source object to create the ServiceInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("load" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["load"] = "";
		if (!("active" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["active"] = "";
		if (!("sub" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["sub"] = "";
		if (!("description" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["description"] = "";
		if (!("enabled" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["enabled"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ServiceInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ServiceInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new ServiceInfo($$parsedSource);
	}
};
var SessionInfo = class SessionInfo {
	/**
	* Creates a new SessionInfo instance.
	* @param {Partial<SessionInfo>} [$$source = {}] - The source object to create the SessionInfo.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("type" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["type"] = "";
		if (!("title" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["title"] = "";
		if (!("status" in $$source))
 /**
		* @member
		* @type {SessionStatus}
		*/
		this["status"] = SessionStatus.$zero;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new SessionInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {SessionInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new SessionInfo($$parsedSource);
	}
};
/**
* @readonly
* @enum {string}
*/
var SessionStatus = {
	/**
	* The Go zero value for the underlying type of the enum.
	*/
	$zero: "",
	StatusConnecting: "connecting",
	StatusConnected: "connected",
	StatusDisconnected: "disconnected",
	StatusError: "error"
};
/**
* SocksProxy is an optional upstream proxy used as the entry point of a tunnel's
* chain: the first SSH hop is dialed through this proxy instead of directly.
*/
var SocksProxy = class SocksProxy {
	/**
	* Creates a new SocksProxy instance.
	* @param {Partial<SocksProxy>} [$$source = {}] - The source object to create the SocksProxy.
	*/
	constructor($$source = {}) {
		if (!("kind" in $$source))
 /**
		* "socks5" | "http"
		* @member
		* @type {string}
		*/
		this["kind"] = "";
		if (!("host" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["host"] = "";
		if (!("port" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["port"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new SocksProxy instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {SocksProxy}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new SocksProxy($$parsedSource);
	}
};
/**
* Tunnel is one user-configured SSH tunnel. The proxy chain is implicit: it
* recurses the exit connection's own jump host (ConnectionConfig.TunnelSSHConnID)
* — no jump host means a single hop straight to the exit.
*/
var Tunnel = class Tunnel {
	/**
	* Creates a new Tunnel instance.
	* @param {Partial<Tunnel>} [$$source = {}] - The source object to create the Tunnel.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("mode" in $$source))
 /**
		* @member
		* @type {TunnelMode}
		*/
		this["mode"] = TunnelMode.$zero;
		if (!("sshConnId" in $$source))
 /**
		* exit SSH connection (ConnectionConfig.ID)
		* @member
		* @type {string}
		*/
		this["sshConnId"] = "";
		if (!("listenPort" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["listenPort"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new Tunnel instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {Tunnel}
	*/
	static createFrom($$source = {}) {
		const $$createField8_0 = $$createType18$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("upstream" in $$parsedSource) $$parsedSource["upstream"] = $$createField8_0($$parsedSource["upstream"]);
		return new Tunnel($$parsedSource);
	}
};
/**
* TunnelGroup is a display grouping in the tunnels panel (like connection groups).
*/
var TunnelGroup = class TunnelGroup {
	/**
	* Creates a new TunnelGroup instance.
	* @param {Partial<TunnelGroup>} [$$source = {}] - The source object to create the TunnelGroup.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new TunnelGroup instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {TunnelGroup}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new TunnelGroup($$parsedSource);
	}
};
/**
* TunnelMode is the kind of SSH port forwarding a tunnel performs.
* 
* It is a stable, non-localized enum persisted to disk and shown (as-is) in the
* picker. The UI never translates these values; only their descriptions go
* through i18n.
* @readonly
* @enum {string}
*/
var TunnelMode = {
	/**
	* The Go zero value for the underlying type of the enum.
	*/
	$zero: "",
	/**
	* TunnelLocal forwards a local listening port to a destination host:port
	* reached from the exit SSH connection (ssh -L).
	*/
	TunnelLocal: "local",
	/**
	* TunnelRemote listens on the exit host and forwards back to a local
	* destination host:port (ssh -R).
	*/
	TunnelRemote: "remote",
	/**
	* TunnelDynamic runs a local SOCKS5 proxy whose connections egress through
	* the exit SSH connection (ssh -D). The SOCKS5 server runs on this machine;
	* nothing is installed on the server.
	*/
	TunnelDynamic: "dynamic"
};
/**
* TunnelState is the runtime state of a tunnel, pushed to the frontend via the
* "tunnel:state" event.
*/
var TunnelState = class TunnelState {
	/**
	* Creates a new TunnelState instance.
	* @param {Partial<TunnelState>} [$$source = {}] - The source object to create the TunnelState.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("status" in $$source))
 /**
		* @member
		* @type {TunnelStatus}
		*/
		this["status"] = TunnelStatus.$zero;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new TunnelState instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {TunnelState}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new TunnelState($$parsedSource);
	}
};
/**
* TunnelStatus is a tunnel's runtime lifecycle state (not persisted).
* @readonly
* @enum {string}
*/
var TunnelStatus = {
	/**
	* The Go zero value for the underlying type of the enum.
	*/
	$zero: "",
	TunnelStopped: "stopped",
	TunnelRunning: "running",
	TunnelError: "error"
};
/**
* TunnelStoreData is the persisted shape of tunnels.json.
*/
var TunnelStoreData = class TunnelStoreData {
	/**
	* Creates a new TunnelStoreData instance.
	* @param {Partial<TunnelStoreData>} [$$source = {}] - The source object to create the TunnelStoreData.
	*/
	constructor($$source = {}) {
		if (!("version" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["version"] = 0;
		if (!("groups" in $$source))
 /**
		* @member
		* @type {TunnelGroup[]}
		*/
		this["groups"] = [];
		if (!("tunnels" in $$source))
 /**
		* @member
		* @type {Tunnel[]}
		*/
		this["tunnels"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new TunnelStoreData instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {TunnelStoreData}
	*/
	static createFrom($$source = {}) {
		const $$createField1_0 = $$createType20$2;
		const $$createField2_0 = $$createType22$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("groups" in $$parsedSource) $$parsedSource["groups"] = $$createField1_0($$parsedSource["groups"]);
		if ("tunnels" in $$parsedSource) $$parsedSource["tunnels"] = $$createField2_0($$parsedSource["tunnels"]);
		return new TunnelStoreData($$parsedSource);
	}
};
var $$createType0$4 = PostLoginExpectStep.createFrom;
var $$createType1$4 = Array$1($$createType0$4);
var $$createType2$3 = ConnectionGroup.createFrom;
var $$createType3$3 = Array$1($$createType2$3);
var $$createType4$3 = ConnectionConfig.createFrom;
var $$createType5$2 = Array$1($$createType4$3);
var $$createType6$2 = Array$1(Any);
var $$createType7$2 = FileItem.createFrom;
var $$createType8$2 = Array$1($$createType7$2);
var $$createType9$2 = SensorInfo.createFrom;
var $$createType10$2 = Array$1($$createType9$2);
var $$createType11$2 = Identity.createFrom;
var $$createType12$2 = Array$1($$createType11$2);
var $$createType13$2 = Proxy.createFrom;
var $$createType14$2 = Array$1($$createType13$2);
var $$createType15$2 = RedisKeyInfo.createFrom;
var $$createType16$2 = Array$1($$createType15$2);
var $$createType17$2 = SocksProxy.createFrom;
var $$createType18$2 = Nullable($$createType17$2);
var $$createType19$2 = TunnelGroup.createFrom;
var $$createType20$2 = Array$1($$createType19$2);
var $$createType21$1 = Tunnel.createFrom;
var $$createType22$1 = Array$1($$createType21$1);
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/importer/models.js
/**
* ImportResult is the normalized output of every provider. IDs are already
* regenerated; Warnings records non-fatal issues (e.g. "password not imported").
*/
var ImportResult = class ImportResult {
	/**
	* Creates a new ImportResult instance.
	* @param {Partial<ImportResult>} [$$source = {}] - The source object to create the ImportResult.
	*/
	constructor($$source = {}) {
		if (!("groups" in $$source))
 /**
		* @member
		* @type {session$0.ConnectionGroup[]}
		*/
		this["groups"] = [];
		if (!("connections" in $$source))
 /**
		* @member
		* @type {session$0.ConnectionConfig[]}
		*/
		this["connections"] = [];
		if (!("warnings" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["warnings"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ImportResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ImportResult}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType1$3;
		const $$createField1_0 = $$createType3$2;
		const $$createField2_0 = $$createType4$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("groups" in $$parsedSource) $$parsedSource["groups"] = $$createField0_0($$parsedSource["groups"]);
		if ("connections" in $$parsedSource) $$parsedSource["connections"] = $$createField1_0($$parsedSource["connections"]);
		if ("warnings" in $$parsedSource) $$parsedSource["warnings"] = $$createField2_0($$parsedSource["warnings"]);
		return new ImportResult($$parsedSource);
	}
};
var $$createType0$3 = ConnectionGroup.createFrom;
var $$createType1$3 = Array$1($$createType0$3);
var $$createType2$2 = ConnectionConfig.createFrom;
var $$createType3$2 = Array$1($$createType2$2);
var $$createType4$2 = Array$1(Any);
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/k8s/models.js
var ContextInfo = class ContextInfo {
	/**
	* Creates a new ContextInfo instance.
	* @param {Partial<ContextInfo>} [$$source = {}] - The source object to create the ContextInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("cluster" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["cluster"] = "";
		if (!("user" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["user"] = "";
		if (!("namespace" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["namespace"] = "";
		if (!("current" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["current"] = false;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ContextInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ContextInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new ContextInfo($$parsedSource);
	}
};
//#endregion
//#region bindings/encoding/json/jsontext/models.js
/**
* Value represents a single raw JSON value, which may be one of the following:
*   - a JSON literal (i.e., null, true, or false)
*   - a JSON string (e.g., "hello, world!")
*   - a JSON number (e.g., 123.456)
*   - an entire JSON object (e.g., {"fizz":"buzz"} )
*   - an entire JSON array (e.g., [1,2,3] )
* 
* Value can represent entire array or object values, while [Token] cannot.
* Value may contain leading and/or trailing whitespace.
* @typedef {any} Value
*/
//#endregion
//#region bindings/encoding/json/models.js
/**
* RawMessage is a raw encoded JSON value.
* It implements [Marshaler] and [Unmarshaler] and can
* be used to delay JSON decoding or precompute a JSON encoding.
* @typedef {jsontext$0.Value} RawMessage
*/
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/mcp/models.js
/**
* MCPToolInfo is the wire shape returned to the frontend via Wails bindings.
* It mirrors MCPTool but is declared in this package so the binding generator
* emits a stable, importable type.
*/
var MCPToolInfo = class MCPToolInfo {
	/**
	* Creates a new MCPToolInfo instance.
	* @param {Partial<MCPToolInfo>} [$$source = {}] - The source object to create the MCPToolInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("description" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["description"] = "";
		if (!("inputSchema" in $$source))
 /**
		* @member
		* @type {json$0.RawMessage}
		*/
		this["inputSchema"] = null;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new MCPToolInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {MCPToolInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new MCPToolInfo($$parsedSource);
	}
};
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/platform/models.js
/**
* FontInfo is one entry in the terminal font picker: a family name together
* with whether it is monospaced. The frontend filters this client-side (keeps
* only IsMono entries in its "monospace only" view, or shows everything).
*/
var FontInfo = class FontInfo {
	/**
	* Creates a new FontInfo instance.
	* @param {Partial<FontInfo>} [$$source = {}] - The source object to create the FontInfo.
	*/
	constructor($$source = {}) {
		if (!("Name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["Name"] = "";
		if (!("IsMono" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["IsMono"] = false;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new FontInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {FontInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new FontInfo($$parsedSource);
	}
};
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/recorder/models.js
/**
* RecordingInfo describes a saved recording file for the UI list.
*/
var RecordingInfo = class RecordingInfo {
	/**
	* Creates a new RecordingInfo instance.
	* @param {Partial<RecordingInfo>} [$$source = {}] - The source object to create the RecordingInfo.
	*/
	constructor($$source = {}) {
		if (!("filePath" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["filePath"] = "";
		if (!("fileName" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["fileName"] = "";
		if (!("sessionId" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["sessionId"] = "";
		if (!("startTime" in $$source))
 /**
		* unix seconds, parsed from filename
		* @member
		* @type {number}
		*/
		this["startTime"] = 0;
		if (!("duration" in $$source))
 /**
		* seconds, derived from last data row
		* @member
		* @type {number}
		*/
		this["duration"] = 0;
		if (!("size" in $$source))
 /**
		* bytes
		* @member
		* @type {number}
		*/
		this["size"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new RecordingInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {RecordingInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new RecordingInfo($$parsedSource);
	}
};
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/store/models.js
/**
* AIConfig is the legacy flat AI config type, kept for Wails binding compatibility.
* New code should use AppSettings.AI (active model from AISettings).
*/
var AIConfig = class AIConfig {
	/**
	* Creates a new AIConfig instance.
	* @param {Partial<AIConfig>} [$$source = {}] - The source object to create the AIConfig.
	*/
	constructor($$source = {}) {
		if (!("apiKey" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["apiKey"] = "";
		if (!("baseURL" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["baseURL"] = "";
		if (!("model" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["model"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new AIConfig instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {AIConfig}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new AIConfig($$parsedSource);
	}
};
var AIMessageEntry = class AIMessageEntry {
	/**
	* Creates a new AIMessageEntry instance.
	* @param {Partial<AIMessageEntry>} [$$source = {}] - The source object to create the AIMessageEntry.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("role" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["role"] = "";
		if (!("content" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["content"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new AIMessageEntry instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {AIMessageEntry}
	*/
	static createFrom($$source = {}) {
		const $$createField4_0 = $$createType0$2;
		const $$createField5_0 = $$createType0$2;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("tool_calls" in $$parsedSource) $$parsedSource["tool_calls"] = $$createField4_0($$parsedSource["tool_calls"]);
		if ("pendingTools" in $$parsedSource) $$parsedSource["pendingTools"] = $$createField5_0($$parsedSource["pendingTools"]);
		return new AIMessageEntry($$parsedSource);
	}
};
var AIModelConfig = class AIModelConfig {
	/**
	* Creates a new AIModelConfig instance.
	* @param {Partial<AIModelConfig>} [$$source = {}] - The source object to create the AIModelConfig.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("apiKey" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["apiKey"] = "";
		if (!("baseURL" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["baseURL"] = "";
		if (!("model" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["model"] = "";
		if (!("protocol" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["protocol"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new AIModelConfig instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {AIModelConfig}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new AIModelConfig($$parsedSource);
	}
};
var AISessionData = class AISessionData {
	/**
	* Creates a new AISessionData instance.
	* @param {Partial<AISessionData>} [$$source = {}] - The source object to create the AISessionData.
	*/
	constructor($$source = {}) {
		if (!("sessions" in $$source))
 /**
		* @member
		* @type {AISessionEntry[]}
		*/
		this["sessions"] = [];
		if (!("currentSessionId" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["currentSessionId"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new AISessionData instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {AISessionData}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType2$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("sessions" in $$parsedSource) $$parsedSource["sessions"] = $$createField0_0($$parsedSource["sessions"]);
		return new AISessionData($$parsedSource);
	}
};
var AISessionEntry = class AISessionEntry {
	/**
	* Creates a new AISessionEntry instance.
	* @param {Partial<AISessionEntry>} [$$source = {}] - The source object to create the AISessionEntry.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("createdAt" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["createdAt"] = 0;
		if (!("updatedAt" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["updatedAt"] = 0;
		if (!("messages" in $$source))
 /**
		* @member
		* @type {AIMessageEntry[]}
		*/
		this["messages"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new AISessionEntry instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {AISessionEntry}
	*/
	static createFrom($$source = {}) {
		const $$createField4_0 = $$createType4$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("messages" in $$parsedSource) $$parsedSource["messages"] = $$createField4_0($$parsedSource["messages"]);
		return new AISessionEntry($$parsedSource);
	}
};
var AISettings = class AISettings {
	/**
	* Creates a new AISettings instance.
	* @param {Partial<AISettings>} [$$source = {}] - The source object to create the AISettings.
	*/
	constructor($$source = {}) {
		if (!("maxTurns" in $$source))
 /**
		* @member
		* @type {number | null}
		*/
		this["maxTurns"] = null;
		if (!("models" in $$source))
 /**
		* @member
		* @type {AIModelConfig[]}
		*/
		this["models"] = [];
		if (!("activeModelId" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["activeModelId"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new AISettings instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {AISettings}
	*/
	static createFrom($$source = {}) {
		const $$createField1_0 = $$createType6$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("models" in $$parsedSource) $$parsedSource["models"] = $$createField1_0($$parsedSource["models"]);
		return new AISettings($$parsedSource);
	}
};
var AppSettings = class AppSettings {
	/**
	* Creates a new AppSettings instance.
	* @param {Partial<AppSettings>} [$$source = {}] - The source object to create the AppSettings.
	*/
	constructor($$source = {}) {
		if (!("theme" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["theme"] = "";
		if (!("language" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["language"] = "";
		if (!("terminal" in $$source))
 /**
		* @member
		* @type {TerminalSettings}
		*/
		this["terminal"] = new TerminalSettings();
		if (!("ai" in $$source))
 /**
		* @member
		* @type {AISettings}
		*/
		this["ai"] = new AISettings();
		if (!("keyboard" in $$source))
 /**
		* @member
		* @type {{ [_ in string]?: KeyBinding }}
		*/
		this["keyboard"] = {};
		if (!("autoCheckUpdate" in $$source))
 /**
		* @member
		* @type {boolean | null}
		*/
		this["autoCheckUpdate"] = null;
		if (!("closeTabPrompt" in $$source))
 /**
		* @member
		* @type {boolean | null}
		*/
		this["closeTabPrompt"] = null;
		if (!("closeAppPrompt" in $$source))
 /**
		* @member
		* @type {boolean | null}
		*/
		this["closeAppPrompt"] = null;
		if (!("sftpBookmarks" in $$source))
 /**
		* @member
		* @type {SFTPBookmarks}
		*/
		this["sftpBookmarks"] = new SFTPBookmarks();
		if (!("customTerminalThemes" in $$source))
 /**
		* @member
		* @type {CustomTerminalTheme[]}
		*/
		this["customTerminalThemes"] = [];
		if (!("defaultLocalShell" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["defaultLocalShell"] = "";
		if (!("tabCloseButton" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["tabCloseButton"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new AppSettings instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {AppSettings}
	*/
	static createFrom($$source = {}) {
		const $$createField2_0 = $$createType7$1;
		const $$createField3_0 = $$createType8$1;
		const $$createField4_0 = $$createType10$1;
		const $$createField8_0 = $$createType11$1;
		const $$createField9_0 = $$createType13$1;
		const $$createField12_0 = $$createType14$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("terminal" in $$parsedSource) $$parsedSource["terminal"] = $$createField2_0($$parsedSource["terminal"]);
		if ("ai" in $$parsedSource) $$parsedSource["ai"] = $$createField3_0($$parsedSource["ai"]);
		if ("keyboard" in $$parsedSource) $$parsedSource["keyboard"] = $$createField4_0($$parsedSource["keyboard"]);
		if ("sftpBookmarks" in $$parsedSource) $$parsedSource["sftpBookmarks"] = $$createField8_0($$parsedSource["sftpBookmarks"]);
		if ("customTerminalThemes" in $$parsedSource) $$parsedSource["customTerminalThemes"] = $$createField9_0($$parsedSource["customTerminalThemes"]);
		if ("sidebarTabs" in $$parsedSource) $$parsedSource["sidebarTabs"] = $$createField12_0($$parsedSource["sidebarTabs"]);
		return new AppSettings($$parsedSource);
	}
};
/**
* CommandMeta 是一个 command 暴露给前端的完整视图（文件扫描 + 偏好合并后的结果）。
*/
var CommandMeta = class CommandMeta {
	/**
	* Creates a new CommandMeta instance.
	* @param {Partial<CommandMeta>} [$$source = {}] - The source object to create the CommandMeta.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* = 文件名（去 .md），唯一键（源:文件）
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("description" in $$source))
 /**
		* frontmatter.description，可空（源:文件）
		* @member
		* @type {string}
		*/
		this["description"] = "";
		if (!("argumentHint" in $$source))
 /**
		* frontmatter.argument-hint，可空（源:文件）
		* @member
		* @type {string}
		*/
		this["argumentHint"] = "";
		if (!("origin" in $$source))
 /**
		* created | imported（源:prefs）
		* @member
		* @type {string}
		*/
		this["origin"] = "";
		if (!("locked" in $$source))
 /**
		* 锁定态（源:prefs）
		* @member
		* @type {boolean}
		*/
		this["locked"] = false;
		if (!("enabled" in $$source))
 /**
		* 是否进 / 补全（源:prefs）
		* @member
		* @type {boolean}
		*/
		this["enabled"] = false;
		if (!("sortOrder" in $$source))
 /**
		* 列表排序（源:prefs）
		* @member
		* @type {number}
		*/
		this["sortOrder"] = 0;
		if (!("path" in $$source))
 /**
		* .md 文件绝对路径（源:文件）
		* @member
		* @type {string}
		*/
		this["path"] = "";
		if (!("createdAt" in $$source))
 /**
		* RFC3339（源:prefs）
		* @member
		* @type {string}
		*/
		this["createdAt"] = "";
		if (!("version" in $$source))
 /**
		* 版本号（源:prefs）
		* @member
		* @type {number}
		*/
		this["version"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new CommandMeta instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {CommandMeta}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new CommandMeta($$parsedSource);
	}
};
/**
* CustomTerminalTheme is a user-defined terminal color scheme, stored
* alongside (not inside) TerminalSettings since a theme is a reusable
* resource, not a single terminal session's property.
*/
var CustomTerminalTheme = class CustomTerminalTheme {
	/**
	* Creates a new CustomTerminalTheme instance.
	* @param {Partial<CustomTerminalTheme>} [$$source = {}] - The source object to create the CustomTerminalTheme.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("type" in $$source))
 /**
		* "dark" | "light"
		* @member
		* @type {string}
		*/
		this["type"] = "";
		if (!("colors" in $$source))
 /**
		* @member
		* @type {TerminalThemeColors}
		*/
		this["colors"] = new TerminalThemeColors();
		Object.assign(this, $$source);
	}
	/**
	* Creates a new CustomTerminalTheme instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {CustomTerminalTheme}
	*/
	static createFrom($$source = {}) {
		const $$createField3_0 = $$createType15$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("colors" in $$parsedSource) $$parsedSource["colors"] = $$createField3_0($$parsedSource["colors"]);
		return new CustomTerminalTheme($$parsedSource);
	}
};
var HistoryEntry = class HistoryEntry {
	/**
	* Creates a new HistoryEntry instance.
	* @param {Partial<HistoryEntry>} [$$source = {}] - The source object to create the HistoryEntry.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("command" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["command"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new HistoryEntry instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {HistoryEntry}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new HistoryEntry($$parsedSource);
	}
};
var KeyBinding = class KeyBinding {
	/**
	* Creates a new KeyBinding instance.
	* @param {Partial<KeyBinding>} [$$source = {}] - The source object to create the KeyBinding.
	*/
	constructor($$source = {}) {
		if (!("ctrl" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["ctrl"] = false;
		if (!("meta" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["meta"] = false;
		if (!("shift" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["shift"] = false;
		if (!("alt" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["alt"] = false;
		if (!("key" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["key"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new KeyBinding instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {KeyBinding}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new KeyBinding($$parsedSource);
	}
};
var LocalState = class LocalState {
	/**
	* Creates a new LocalState instance.
	* @param {Partial<LocalState>} [$$source = {}] - The source object to create the LocalState.
	*/
	constructor($$source = {}) {
		if (!("sidebarVisible" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["sidebarVisible"] = false;
		if (!("aiSidebarVisible" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["aiSidebarVisible"] = false;
		if (!("collapsedGroupIds" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["collapsedGroupIds"] = [];
		if (!("collapsedQuickCommandGroupIds" in $$source))
 /**
		* Collapsed quick-command group ids (plus "__ungrouped__"). Local-only
		* UI state, never synced; groups absent from the list stay expanded.
		* @member
		* @type {string[]}
		*/
		this["collapsedQuickCommandGroupIds"] = [];
		if (!("windowX" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["windowX"] = 0;
		if (!("windowY" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["windowY"] = 0;
		if (!("windowWidth" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["windowWidth"] = 0;
		if (!("windowHeight" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["windowHeight"] = 0;
		if (!("windowMaximised" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["windowMaximised"] = false;
		if (!("backgroundEnabled" in $$source))
 /**
		* Background image — local-only appearance, never synced.
		* @member
		* @type {boolean}
		*/
		this["backgroundEnabled"] = false;
		if (!("backgroundImage" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["backgroundImage"] = "";
		if (!("backgroundOpacity" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["backgroundOpacity"] = 0;
		if (!("backgroundBlur" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["backgroundBlur"] = 0;
		if (!("backgroundFit" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["backgroundFit"] = "";
		if (!("systemTitleBar" in $$source))
 /**
		* SystemTitleBar switches the window to the OS native frame instead of
		* the built-in one. Read at startup only — changing it needs a restart.
		* @member
		* @type {boolean}
		*/
		this["systemTitleBar"] = false;
		if (!("externalEditor" in $$source))
 /**
		* ExternalEditor command used to open remote files in an external editor
		* (SFTP "edit externally"). Local-only preference, never synced.
		* @member
		* @type {string}
		*/
		this["externalEditor"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new LocalState instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {LocalState}
	*/
	static createFrom($$source = {}) {
		const $$createField2_0 = $$createType16$1;
		const $$createField3_0 = $$createType16$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("collapsedGroupIds" in $$parsedSource) $$parsedSource["collapsedGroupIds"] = $$createField2_0($$parsedSource["collapsedGroupIds"]);
		if ("collapsedQuickCommandGroupIds" in $$parsedSource) $$parsedSource["collapsedQuickCommandGroupIds"] = $$createField3_0($$parsedSource["collapsedQuickCommandGroupIds"]);
		return new LocalState($$parsedSource);
	}
};
var QuickCommand = class QuickCommand {
	/**
	* Creates a new QuickCommand instance.
	* @param {Partial<QuickCommand>} [$$source = {}] - The source object to create the QuickCommand.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("command" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["command"] = "";
		if (!("sortOrder" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["sortOrder"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new QuickCommand instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {QuickCommand}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new QuickCommand($$parsedSource);
	}
};
var QuickCommandData = class QuickCommandData {
	/**
	* Creates a new QuickCommandData instance.
	* @param {Partial<QuickCommandData>} [$$source = {}] - The source object to create the QuickCommandData.
	*/
	constructor($$source = {}) {
		if (!("version" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["version"] = 0;
		if (!("groups" in $$source))
 /**
		* @member
		* @type {QuickCommandGroup[]}
		*/
		this["groups"] = [];
		if (!("commands" in $$source))
 /**
		* @member
		* @type {QuickCommand[]}
		*/
		this["commands"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new QuickCommandData instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {QuickCommandData}
	*/
	static createFrom($$source = {}) {
		const $$createField1_0 = $$createType18$1;
		const $$createField2_0 = $$createType20$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("groups" in $$parsedSource) $$parsedSource["groups"] = $$createField1_0($$parsedSource["groups"]);
		if ("commands" in $$parsedSource) $$parsedSource["commands"] = $$createField2_0($$parsedSource["commands"]);
		return new QuickCommandData($$parsedSource);
	}
};
var QuickCommandGroup = class QuickCommandGroup {
	/**
	* Creates a new QuickCommandGroup instance.
	* @param {Partial<QuickCommandGroup>} [$$source = {}] - The source object to create the QuickCommandGroup.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("sortOrder" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["sortOrder"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new QuickCommandGroup instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {QuickCommandGroup}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new QuickCommandGroup($$parsedSource);
	}
};
var SFTPBookmarks = class SFTPBookmarks {
	/**
	* Creates a new SFTPBookmarks instance.
	* @param {Partial<SFTPBookmarks>} [$$source = {}] - The source object to create the SFTPBookmarks.
	*/
	constructor($$source = {}) {
		if (!("localPaths" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["localPaths"] = [];
		if (!("remotePaths" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["remotePaths"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new SFTPBookmarks instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {SFTPBookmarks}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType16$1;
		const $$createField1_0 = $$createType16$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("localPaths" in $$parsedSource) $$parsedSource["localPaths"] = $$createField0_0($$parsedSource["localPaths"]);
		if ("remotePaths" in $$parsedSource) $$parsedSource["remotePaths"] = $$createField1_0($$parsedSource["remotePaths"]);
		return new SFTPBookmarks($$parsedSource);
	}
};
/**
* SkillFileList 列出一个 skill 的 references/ 与 scripts/ 下的相对路径（供 use_skill 组装资源清单）。
*/
var SkillFileList = class SkillFileList {
	/**
	* Creates a new SkillFileList instance.
	* @param {Partial<SkillFileList>} [$$source = {}] - The source object to create the SkillFileList.
	*/
	constructor($$source = {}) {
		if (!("references" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["references"] = [];
		if (!("scripts" in $$source))
 /**
		* @member
		* @type {string[]}
		*/
		this["scripts"] = [];
		Object.assign(this, $$source);
	}
	/**
	* Creates a new SkillFileList instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {SkillFileList}
	*/
	static createFrom($$source = {}) {
		const $$createField0_0 = $$createType16$1;
		const $$createField1_0 = $$createType16$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("references" in $$parsedSource) $$parsedSource["references"] = $$createField0_0($$parsedSource["references"]);
		if ("scripts" in $$parsedSource) $$parsedSource["scripts"] = $$createField1_0($$parsedSource["scripts"]);
		return new SkillFileList($$parsedSource);
	}
};
/**
* SkillMeta 是一个 skill 暴露给前端的完整视图（目录扫描 + 偏好合并后的结果）。
*/
var SkillMeta = class SkillMeta {
	/**
	* Creates a new SkillMeta instance.
	* @param {Partial<SkillMeta>} [$$source = {}] - The source object to create the SkillMeta.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* = frontmatter.name，唯一键（源:目录）
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("description" in $$source))
 /**
		* L1 索引内容（源:目录）
		* @member
		* @type {string}
		*/
		this["description"] = "";
		if (!("isSystem" in $$source))
 /**
		* 是否在 .system/（源:目录）
		* @member
		* @type {boolean}
		*/
		this["isSystem"] = false;
		if (!("origin" in $$source))
 /**
		* created | imported，仅展示/筛选（源:prefs）
		* @member
		* @type {string}
		*/
		this["origin"] = "";
		if (!("locked" in $$source))
 /**
		* 锁定态（源:prefs）
		* @member
		* @type {boolean}
		*/
		this["locked"] = false;
		if (!("enabled" in $$source))
 /**
		* 是否进 L1/补全/识别（源:prefs）
		* @member
		* @type {boolean}
		*/
		this["enabled"] = false;
		if (!("sortOrder" in $$source))
 /**
		* 列表排序（源:prefs）
		* @member
		* @type {number}
		*/
		this["sortOrder"] = 0;
		if (!("dir" in $$source))
 /**
		* 存储目录名，可 ≠ name（源:目录）
		* @member
		* @type {string}
		*/
		this["dir"] = "";
		if (!("path" in $$source))
 /**
		* skill 目录的绝对路径（源:目录）
		* @member
		* @type {string}
		*/
		this["path"] = "";
		if (!("hasReferences" in $$source))
 /**
		* 是否文件夹型（有 references/）（源:目录）
		* @member
		* @type {boolean}
		*/
		this["hasReferences"] = false;
		if (!("scriptCount" in $$source))
 /**
		* scripts/ 文件数（源:目录）
		* @member
		* @type {number}
		*/
		this["scriptCount"] = 0;
		if (!("modelInvocable" in $$source))
 /**
		* = !disable-model-invocation（源:目录）
		* @member
		* @type {boolean}
		*/
		this["modelInvocable"] = false;
		if (!("createdModel" in $$source))
 /**
		* 写作时面向的模型（源:目录 frontmatter，可空）
		* @member
		* @type {string}
		*/
		this["createdModel"] = "";
		if (!("createdAt" in $$source))
 /**
		* RFC3339（源:prefs）
		* @member
		* @type {string}
		*/
		this["createdAt"] = "";
		if (!("version" in $$source))
 /**
		* 版本号（源:prefs）
		* @member
		* @type {number}
		*/
		this["version"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new SkillMeta instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {SkillMeta}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new SkillMeta($$parsedSource);
	}
};
var TerminalSettings = class TerminalSettings {
	/**
	* Creates a new TerminalSettings instance.
	* @param {Partial<TerminalSettings>} [$$source = {}] - The source object to create the TerminalSettings.
	*/
	constructor($$source = {}) {
		if (!("theme" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["theme"] = "";
		if (!("fontFamily" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["fontFamily"] = "";
		if (!("fontSize" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["fontSize"] = 0;
		if (!("selectionAction" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["selectionAction"] = "";
		if (!("rightClickAction" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["rightClickAction"] = "";
		if (!("middleClickAction" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["middleClickAction"] = "";
		if (!("maxHistoryLines" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["maxHistoryLines"] = 0;
		if (!("smartCompletion" in $$source))
 /**
		* @member
		* @type {boolean | null}
		*/
		this["smartCompletion"] = null;
		if (!("aiTranscription" in $$source))
 /**
		* @member
		* @type {boolean | null}
		*/
		this["aiTranscription"] = null;
		if (!("highlightEnabled" in $$source))
 /**
		* @member
		* @type {boolean | null}
		*/
		this["highlightEnabled"] = null;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new TerminalSettings instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {TerminalSettings}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new TerminalSettings($$parsedSource);
	}
};
/**
* TerminalThemeColors mirrors xterm.js's ITheme shape: the 4 base colors
* plus the 16 ANSI colors, all as hex strings.
*/
var TerminalThemeColors = class TerminalThemeColors {
	/**
	* Creates a new TerminalThemeColors instance.
	* @param {Partial<TerminalThemeColors>} [$$source = {}] - The source object to create the TerminalThemeColors.
	*/
	constructor($$source = {}) {
		if (!("background" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["background"] = "";
		if (!("foreground" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["foreground"] = "";
		if (!("cursor" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["cursor"] = "";
		if (!("selection" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["selection"] = "";
		if (!("black" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["black"] = "";
		if (!("red" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["red"] = "";
		if (!("green" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["green"] = "";
		if (!("yellow" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["yellow"] = "";
		if (!("blue" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["blue"] = "";
		if (!("magenta" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["magenta"] = "";
		if (!("cyan" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["cyan"] = "";
		if (!("white" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["white"] = "";
		if (!("brightBlack" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["brightBlack"] = "";
		if (!("brightRed" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["brightRed"] = "";
		if (!("brightGreen" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["brightGreen"] = "";
		if (!("brightYellow" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["brightYellow"] = "";
		if (!("brightBlue" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["brightBlue"] = "";
		if (!("brightMagenta" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["brightMagenta"] = "";
		if (!("brightCyan" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["brightCyan"] = "";
		if (!("brightWhite" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["brightWhite"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new TerminalThemeColors instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {TerminalThemeColors}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new TerminalThemeColors($$parsedSource);
	}
};
var $$createType0$2 = Array$1(Any);
var $$createType1$2 = AISessionEntry.createFrom;
var $$createType2$1 = Array$1($$createType1$2);
var $$createType3$1 = AIMessageEntry.createFrom;
var $$createType4$1 = Array$1($$createType3$1);
var $$createType5$1 = AIModelConfig.createFrom;
var $$createType6$1 = Array$1($$createType5$1);
var $$createType7$1 = TerminalSettings.createFrom;
var $$createType8$1 = AISettings.createFrom;
var $$createType9$1 = KeyBinding.createFrom;
var $$createType10$1 = Map$1(Any, $$createType9$1);
var $$createType11$1 = SFTPBookmarks.createFrom;
var $$createType12$1 = CustomTerminalTheme.createFrom;
var $$createType13$1 = Array$1($$createType12$1);
var $$createType14$1 = Map$1(Any, Any);
var $$createType15$1 = TerminalThemeColors.createFrom;
var $$createType16$1 = Array$1(Any);
var $$createType17$1 = QuickCommandGroup.createFrom;
var $$createType18$1 = Array$1($$createType17$1);
var $$createType19$1 = QuickCommand.createFrom;
var $$createType20$1 = Array$1($$createType19$1);
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/sync/models.js
var ConflictInfo = class ConflictInfo {
	/**
	* Creates a new ConflictInfo instance.
	* @param {Partial<ConflictInfo>} [$$source = {}] - The source object to create the ConflictInfo.
	*/
	constructor($$source = {}) {
		if (!("localTime" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["localTime"] = "0001-01-01T00:00:00.000Z";
		if (!("remoteTime" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["remoteTime"] = "0001-01-01T00:00:00.000Z";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ConflictInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ConflictInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new ConflictInfo($$parsedSource);
	}
};
var SyncConfig = class SyncConfig {
	/**
	* Creates a new SyncConfig instance.
	* @param {Partial<SyncConfig>} [$$source = {}] - The source object to create the SyncConfig.
	*/
	constructor($$source = {}) {
		if (!("repoUrl" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["repoUrl"] = "";
		if (!("branch" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["branch"] = "";
		if (!("username" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["username"] = "";
		if (!("autoSync" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["autoSync"] = false;
		if (!("lastSyncAt" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["lastSyncAt"] = "0001-01-01T00:00:00.000Z";
		if (!("lastSyncStatus" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["lastSyncStatus"] = "";
		if (!("lastSyncError" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["lastSyncError"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new SyncConfig instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {SyncConfig}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new SyncConfig($$parsedSource);
	}
};
/**
* @readonly
* @enum {number}
*/
var SyncDirection = {
	/**
	* The Go zero value for the underlying type of the enum.
	*/
	$zero: 0,
	SyncNone: 0,
	SyncPush: 1,
	SyncPull: 2,
	SyncConflict: 3
};
var SyncResult = class SyncResult {
	/**
	* Creates a new SyncResult instance.
	* @param {Partial<SyncResult>} [$$source = {}] - The source object to create the SyncResult.
	*/
	constructor($$source = {}) {
		if (!("direction" in $$source))
 /**
		* @member
		* @type {SyncDirection}
		*/
		this["direction"] = SyncDirection.$zero;
		if (!("message" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["message"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new SyncResult instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {SyncResult}
	*/
	static createFrom($$source = {}) {
		const $$createField2_0 = $$createType1$1;
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		if ("conflict" in $$parsedSource) $$parsedSource["conflict"] = $$createField2_0($$parsedSource["conflict"]);
		return new SyncResult($$parsedSource);
	}
};
var $$createType0$1 = ConflictInfo.createFrom;
var $$createType1$1 = Nullable($$createType0$1);
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/backend/update/models.js
/**
* UpdateInfo is the result returned to the frontend.
*/
var UpdateInfo = class UpdateInfo {
	/**
	* Creates a new UpdateInfo instance.
	* @param {Partial<UpdateInfo>} [$$source = {}] - The source object to create the UpdateInfo.
	*/
	constructor($$source = {}) {
		if (!("hasUpdate" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["hasUpdate"] = false;
		if (!("current" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["current"] = "";
		if (!("latest" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["latest"] = "";
		if (!("releaseUrl" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["releaseUrl"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new UpdateInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {UpdateInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new UpdateInfo($$parsedSource);
	}
};
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/models.js
var AppInfo = class AppInfo {
	/**
	* Creates a new AppInfo instance.
	* @param {Partial<AppInfo>} [$$source = {}] - The source object to create the AppInfo.
	*/
	constructor($$source = {}) {
		if (!("name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["name"] = "";
		if (!("version" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["version"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new AppInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {AppInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new AppInfo($$parsedSource);
	}
};
var CredentialStatus = class CredentialStatus {
	/**
	* Creates a new CredentialStatus instance.
	* @param {Partial<CredentialStatus>} [$$source = {}] - The source object to create the CredentialStatus.
	*/
	constructor($$source = {}) {
		if (!("mode" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["mode"] = "";
		if (!("unlocked" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["unlocked"] = false;
		if (!("needsSetup" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["needsSetup"] = false;
		if (!("keychainLost" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["keychainLost"] = false;
		if (!("existingSecrets" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["existingSecrets"] = 0;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new CredentialStatus instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {CredentialStatus}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new CredentialStatus($$parsedSource);
	}
};
var DataDirInfo = class DataDirInfo {
	/**
	* Creates a new DataDirInfo instance.
	* @param {Partial<DataDirInfo>} [$$source = {}] - The source object to create the DataDirInfo.
	*/
	constructor($$source = {}) {
		if (!("dataDir" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["dataDir"] = "";
		if (!("type" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["type"] = "";
		if (!("firstRun" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["firstRun"] = false;
		Object.assign(this, $$source);
	}
	/**
	* Creates a new DataDirInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {DataDirInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new DataDirInfo($$parsedSource);
	}
};
/**
* ExternalEditorOption describes an external editor that was detected on the
* host. Label is the display text (editor name plus the command), Value is the
* command passed to the editor engine (which appends the temp file path).
*/
var ExternalEditorOption = class ExternalEditorOption {
	/**
	* Creates a new ExternalEditorOption instance.
	* @param {Partial<ExternalEditorOption>} [$$source = {}] - The source object to create the ExternalEditorOption.
	*/
	constructor($$source = {}) {
		if (!("label" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["label"] = "";
		if (!("value" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["value"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ExternalEditorOption instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ExternalEditorOption}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new ExternalEditorOption($$parsedSource);
	}
};
/**
* K8sContextInfo 是前端可见的 context 元信息。
* @typedef {k8s$0.ContextInfo} K8sContextInfo
*/
/**
* K8sResponse 是前端可见的 REST 响应。Body 为 JSON 原文字符串。
*/
var K8sResponse = class K8sResponse {
	/**
	* Creates a new K8sResponse instance.
	* @param {Partial<K8sResponse>} [$$source = {}] - The source object to create the K8sResponse.
	*/
	constructor($$source = {}) {
		if (!("status" in $$source))
 /**
		* @member
		* @type {number}
		*/
		this["status"] = 0;
		if (!("body" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["body"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new K8sResponse instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {K8sResponse}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new K8sResponse($$parsedSource);
	}
};
/**
* ModelInfo represents a model entry from the /v1/models response.
*/
var ModelInfo = class ModelInfo {
	/**
	* Creates a new ModelInfo instance.
	* @param {Partial<ModelInfo>} [$$source = {}] - The source object to create the ModelInfo.
	*/
	constructor($$source = {}) {
		if (!("id" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["id"] = "";
		if (!("display_name" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["display_name"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new ModelInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {ModelInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new ModelInfo($$parsedSource);
	}
};
/**
* SessionLogInfo describes the current session-log state for a panel.
* Path is "" when Enabled is false.
*/
var SessionLogInfo = class SessionLogInfo {
	/**
	* Creates a new SessionLogInfo instance.
	* @param {Partial<SessionLogInfo>} [$$source = {}] - The source object to create the SessionLogInfo.
	*/
	constructor($$source = {}) {
		if (!("enabled" in $$source))
 /**
		* @member
		* @type {boolean}
		*/
		this["enabled"] = false;
		if (!("path" in $$source))
 /**
		* @member
		* @type {string}
		*/
		this["path"] = "";
		Object.assign(this, $$source);
	}
	/**
	* Creates a new SessionLogInfo instance from a string or object.
	* @param {any} [$$source = {}]
	* @returns {SessionLogInfo}
	*/
	static createFrom($$source = {}) {
		let $$parsedSource = typeof $$source === "string" ? JSON.parse($$source) : $$source;
		return new SessionLogInfo($$parsedSource);
	}
};
//#endregion
//#region bindings/github.com/laigcss/ai-ops-terminal/app.js
/**
* AcceptHostKeyChange replaces the recorded SSH host key for host:port with
* the new key, after the user confirmed the change in the frontend's
* "host key changed" dialog (S1). Subsequent connections will trust the new
* key without prompting.
* @param {string} host
* @param {string} port
* @param {string} keyType
* @param {string} newKeyB64
* @returns {$CancellablePromise<void>}
*/
function AcceptHostKeyChange(host, port, keyType, newKeyB64) {
	return ByID(4273167910, host, port, keyType, newKeyB64);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {database$0.ColumnDef} col
* @returns {$CancellablePromise<void>}
*/
function AddColumn(sessionID, dbName, tableName, col) {
	return ByID(272189630, sessionID, dbName, tableName, col);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {database$0.IndexDef} idx
* @returns {$CancellablePromise<void>}
*/
function AddIndex(sessionID, dbName, tableName, idx) {
	return ByID(2879889064, sessionID, dbName, tableName, idx);
}
/**
* @param {string} path
* @param {string} base64Data
* @param {number} offset
* @returns {$CancellablePromise<void>}
*/
function AppendFileBase64(path, base64Data, offset) {
	return ByID(3578022296, path, base64Data, offset);
}
/**
* ApplyImport merges parsed connections into the existing store and saves,
* reusing existing groups by path. The saved result is broadcast via the
* existing store:connections:changed event.
* @param {session$0.ConnectionStoreData} data
* @returns {$CancellablePromise<void>}
*/
function ApplyImport(data) {
	return ByID(3949113802, data);
}
/**
* CancelChatStream cancels the currently active ChatCompletion stream.
* @returns {$CancellablePromise<void>}
*/
function CancelChatStream() {
	return ByID(1911236813);
}
/**
* @param {string} oldPassword
* @param {string} newPassword
* @returns {$CancellablePromise<void>}
*/
function ChangeMasterPassword(oldPassword, newPassword) {
	return ByID(3088799714, oldPassword, newPassword);
}
/**
* ChatCompletion streams the Anthropic API response via SSE, emitting Wails
* events for each token while collecting the full message. It returns the
* complete message JSON when the stream ends (backward-compatible).
* @param {string} apiKey
* @param {string} baseURL
* @param {string} model
* @param {string} requestJSON
* @param {string} protocol
* @param {string} userAgent
* @param {string} proxyID
* @returns {$CancellablePromise<string>}
*/
function ChatCompletion(apiKey, baseURL, model, requestJSON, protocol, userAgent, proxyID) {
	return ByID(2065994381, apiKey, baseURL, model, requestJSON, protocol, userAgent, proxyID);
}
/**
* @param {string} source
* @returns {$CancellablePromise<update$0.UpdateInfo | null>}
*/
function CheckForUpdate(source) {
	return ByID(2347956003, source).then((($result) => {
		return $$createType1($result);
	}));
}
/**
* ClearBackgroundImage removes any stored background image file.
* @returns {$CancellablePromise<void>}
*/
function ClearBackgroundImage() {
	return ByID(494992479);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<void>}
*/
function CloseSession(sessionID) {
	return ByID(1620748453, sessionID);
}
/**
* @param {string} connectionID
* @param {string} containerID
* @param {string} action
* @returns {$CancellablePromise<void>}
*/
function ContainerAction(connectionID, containerID, action) {
	return ByID(2855963210, connectionID, containerID, action);
}
/**
* ContainerConnect 打开容器连接：解析配置、按 transport 建 Local 或 SSH runner。
* SSH 传输时若被引用连接配了跳板机（TunnelSSHConnID），先起本地转发隧道，
* 与 CreateSession 的单层隧道行为一致。
* @param {string} connectionID
* @returns {$CancellablePromise<void>}
*/
function ContainerConnect(connectionID) {
	return ByID(3618425606, connectionID);
}
/**
* @param {string} connectionID
* @param {container$0.CreateOptions} opts
* @returns {$CancellablePromise<void>}
*/
function ContainerCreate(connectionID, opts) {
	return ByID(1062854484, connectionID, opts);
}
/**
* @param {string} connectionID
* @returns {$CancellablePromise<void>}
*/
function ContainerDisconnect(connectionID) {
	return ByID(715496618, connectionID);
}
/**
* @param {string} connectionID
* @param {string} containerID
* @param {string} shell
* @returns {$CancellablePromise<session$0.SessionInfo | null>}
*/
function ContainerExecSession(connectionID, containerID, shell) {
	return ByID(3278938219, connectionID, containerID, shell).then((($result) => {
		return $$createType3($result);
	}));
}
/**
* @param {string} connectionID
* @returns {$CancellablePromise<container$0.Image[]>}
*/
function ContainerImages(connectionID) {
	return ByID(1429233338, connectionID).then((($result) => {
		return $$createType5($result);
	}));
}
/**
* @param {string} connectionID
* @param {string} containerID
* @returns {$CancellablePromise<container$0.InspectResult>}
*/
function ContainerInspect(connectionID, containerID) {
	return ByID(1719556676, connectionID, containerID).then((($result) => {
		return $$createType6($result);
	}));
}
/**
* @param {string} connectionID
* @returns {$CancellablePromise<container$0.Container[]>}
*/
function ContainerList(connectionID) {
	return ByID(1783859960, connectionID).then((($result) => {
		return $$createType8($result);
	}));
}
/**
* @param {string} connectionID
* @returns {$CancellablePromise<string[]>}
*/
function ContainerNamespaces(connectionID) {
	return ByID(1648751268, connectionID).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* @param {string} connectionID
* @param {string} imageID
* @returns {$CancellablePromise<void>}
*/
function ContainerRemoveImage(connectionID, imageID) {
	return ByID(3771869829, connectionID, imageID);
}
/**
* @param {string} connectionID
* @param {string} containerID
* @param {string} newName
* @returns {$CancellablePromise<void>}
*/
function ContainerRename(connectionID, containerID, newName) {
	return ByID(3764585490, connectionID, containerID, newName);
}
/**
* @param {string} connectionID
* @param {string} ns
* @returns {$CancellablePromise<void>}
*/
function ContainerSetNamespace(connectionID, ns) {
	return ByID(666265775, connectionID, ns);
}
/**
* @param {string} connectionID
* @param {string} containerID
* @param {number} tail
* @param {boolean} timestamps
* @returns {$CancellablePromise<string>}
*/
function ContainerStartLogs(connectionID, containerID, tail, timestamps) {
	return ByID(2732981159, connectionID, containerID, tail, timestamps);
}
/**
* @param {string} connectionID
* @param {string} image
* @returns {$CancellablePromise<string>}
*/
function ContainerStartPull(connectionID, image) {
	return ByID(1816033267, connectionID, image);
}
/**
* @param {string} streamID
* @returns {$CancellablePromise<void>}
*/
function ContainerStopStream(streamID) {
	return ByID(2811399768, streamID);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {string} newTableName
* @returns {$CancellablePromise<void>}
*/
function CopyTable(sessionID, dbName, tableName, newTableName) {
	return ByID(2675317344, sessionID, dbName, tableName, newTableName);
}
/**
* @param {string} name
* @param {string} description
* @param {string} argumentHint
* @param {string} body
* @returns {$CancellablePromise<void>}
*/
function CreateCommand(name, description, argumentHint, body) {
	return ByID(824054418, name, description, argumentHint, body);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @returns {$CancellablePromise<void>}
*/
function CreateDatabase(sessionID, dbName) {
	return ByID(3436940056, sessionID, dbName);
}
/**
* @param {string} sessionType
* @param {session$0.ConnectionConfig} config
* @returns {$CancellablePromise<session$0.SessionInfo | null>}
*/
function CreateSession(sessionType, config) {
	return ByID(2952361431, sessionType, config).then((($result) => {
		return $$createType3($result);
	}));
}
/**
* @param {string} name
* @param {string} description
* @param {string} body
* @returns {$CancellablePromise<void>}
*/
function CreateSkill(name, description, body) {
	return ByID(517818134, name, description, body);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @returns {$CancellablePromise<void>}
*/
function CreateTable(sessionID, dbName, tableName) {
	return ByID(3458043071, sessionID, dbName, tableName);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {number} limit
* @param {number} offset
* @returns {$CancellablePromise<string>}
*/
function DBDefaultTableQuery(sessionID, dbName, tableName, limit, offset) {
	return ByID(1012784308, sessionID, dbName, tableName, limit, offset);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {{ [_ in string]?: any }} where
* @returns {$CancellablePromise<void>}
*/
function DBDeleteRow(sessionID, dbName, tableName, where) {
	return ByID(2673574876, sessionID, dbName, tableName, where);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {{ [_ in string]?: any }} values
* @returns {$CancellablePromise<void>}
*/
function DBInsertRow(sessionID, dbName, tableName, values) {
	return ByID(3729711174, sessionID, dbName, tableName, values);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {{ [_ in string]?: any }} $set
* @param {{ [_ in string]?: any }} where
* @returns {$CancellablePromise<void>}
*/
function DBUpdateRow(sessionID, dbName, tableName, $set, where) {
	return ByID(3363650870, sessionID, dbName, tableName, $set, where);
}
/**
* @param {string} name
* @returns {$CancellablePromise<void>}
*/
function DeleteCommand(name) {
	return ByID(1364106115, name);
}
/**
* @param {string} name
* @returns {$CancellablePromise<void>}
*/
function DeleteSkill(name) {
	return ByID(3246114851, name);
}
/**
* DisableSessionOutputLog closes the log file for the given panel,
* writes a footer banner, detaches the writer from any active session,
* and drops the panel's logger. Idempotent.
* @param {string} panelID
* @returns {$CancellablePromise<void>}
*/
function DisableSessionOutputLog(panelID) {
	return ByID(1783598134, panelID);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {string} colName
* @returns {$CancellablePromise<void>}
*/
function DropColumn(sessionID, dbName, tableName, colName) {
	return ByID(719697558, sessionID, dbName, tableName, colName);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @returns {$CancellablePromise<void>}
*/
function DropDatabase(sessionID, dbName) {
	return ByID(1119946489, sessionID, dbName);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {string} idxName
* @param {boolean} isPrimary
* @param {string[]} autoIncCols
* @returns {$CancellablePromise<void>}
*/
function DropIndexOp(sessionID, dbName, tableName, idxName, isPrimary, autoIncCols) {
	return ByID(3658842167, sessionID, dbName, tableName, idxName, isPrimary, autoIncCols);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @returns {$CancellablePromise<void>}
*/
function DropTable(sessionID, dbName, tableName) {
	return ByID(3675517816, sessionID, dbName, tableName);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} viewName
* @returns {$CancellablePromise<void>}
*/
function DropView(sessionID, dbName, viewName) {
	return ByID(2748309053, sessionID, dbName, viewName);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {boolean} withStructure
* @param {boolean} withData
* @returns {$CancellablePromise<string>}
*/
function DumpTable(sessionID, dbName, tableName, withStructure, withData) {
	return ByID(3833525521, sessionID, dbName, tableName, withStructure, withData);
}
/**
* EnableSessionOutputLog starts writing terminal output for the given
* panel to a .log file. If dir is empty, the default session log
* directory is used. Returns the final path after sanitization and
* same-second collision suffixing.
* 
* The log is bound to the panel, not the session \u2014 so a reconnect
* (which creates a fresh session under the same panel) keeps writing
* to the same file.
* @param {string} panelID
* @param {string} dir
* @returns {$CancellablePromise<string>}
*/
function EnableSessionOutputLog(panelID, dir) {
	return ByID(1365747947, panelID, dir);
}
/**
* @param {string} sessionID
* @param {string} index
* @returns {$CancellablePromise<void>}
*/
function EsCloseIndex(sessionID, index) {
	return ByID(3715846213, sessionID, index);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.EsClusterHealth | null>}
*/
function EsClusterHealth(sessionID) {
	return ByID(4214983043, sessionID).then((($result) => {
		return $$createType13($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.EsClusterInfo | null>}
*/
function EsClusterInfo(sessionID) {
	return ByID(628866441, sessionID).then((($result) => {
		return $$createType15($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} index
* @param {string} bodyJSON
* @returns {$CancellablePromise<void>}
*/
function EsCreateIndex(sessionID, index, bodyJSON) {
	return ByID(3009247479, sessionID, index, bodyJSON);
}
/**
* @param {string} sessionID
* @param {string} index
* @param {string} id
* @returns {$CancellablePromise<void>}
*/
function EsDeleteDoc(sessionID, index, id) {
	return ByID(2986352088, sessionID, index, id);
}
/**
* @param {string} sessionID
* @param {string} index
* @returns {$CancellablePromise<void>}
*/
function EsDeleteIndex(sessionID, index) {
	return ByID(2206919626, sessionID, index);
}
/**
* @param {string} sessionID
* @param {string} index
* @returns {$CancellablePromise<string>}
*/
function EsGetMapping(sessionID, index) {
	return ByID(1218144839, sessionID, index);
}
/**
* @param {string} sessionID
* @param {string} index
* @returns {$CancellablePromise<string>}
*/
function EsGetSettings(sessionID, index) {
	return ByID(3624262766, sessionID, index);
}
/**
* @param {string} sessionID
* @param {string} index
* @param {string} id
* @param {string} docJSON
* @returns {$CancellablePromise<string>}
*/
function EsIndexDoc(sessionID, index, id, docJSON) {
	return ByID(2534046739, sessionID, index, id, docJSON);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.EsIndexInfo[]>}
*/
function EsListIndices(sessionID) {
	return ByID(1791174794, sessionID).then((($result) => {
		return $$createType17($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} index
* @returns {$CancellablePromise<void>}
*/
function EsOpenIndex(sessionID, index) {
	return ByID(1315499459, sessionID, index);
}
/**
* @param {string} sessionID
* @param {string} method
* @param {string} path
* @param {string} bodyJSON
* @returns {$CancellablePromise<session$0.EsRestResult | null>}
*/
function EsRest(sessionID, method, path, bodyJSON) {
	return ByID(3663841571, sessionID, method, path, bodyJSON).then((($result) => {
		return $$createType21($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} index
* @param {string} bodyJSON
* @param {number} $from
* @param {number} size
* @returns {$CancellablePromise<session$0.EsSearchResult | null>}
*/
function EsSearch(sessionID, index, bodyJSON, $from, size) {
	return ByID(4167028621, sessionID, index, bodyJSON, $from, size).then((($result) => {
		return $$createType23($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} index
* @param {string} id
* @param {string} docJSON
* @returns {$CancellablePromise<void>}
*/
function EsUpdateDoc(sessionID, index, id, docJSON) {
	return ByID(1652136606, sessionID, index, id, docJSON);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} sql
* @returns {$CancellablePromise<database$0.QueryResult | null>}
*/
function ExecuteQuery(sessionID, dbName, sql) {
	return ByID(2868660388, sessionID, dbName, sql).then((($result) => {
		return $$createType25($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} script
* @returns {$CancellablePromise<database$0.ScriptResult | null>}
*/
function ExecuteSQLScript(sessionID, dbName, script) {
	return ByID(3857857879, sessionID, dbName, script).then((($result) => {
		return $$createType27($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} sql
* @returns {$CancellablePromise<database$0.ExecResult | null>}
*/
function ExecuteStatement(sessionID, dbName, sql) {
	return ByID(75982109, sessionID, dbName, sql).then((($result) => {
		return $$createType29($result);
	}));
}
/**
* ExportConnections writes the full store to destPath as a .utm file. When
* password is non-empty, password fields are encrypted; otherwise cleared.
* @param {string} destPath
* @param {string} password
* @returns {$CancellablePromise<void>}
*/
function ExportConnections(destPath, password) {
	return ByID(1210140840, destPath, password);
}
/**
* FetchModels fetches the available model list. openai/responses hit an
* OpenAI-compatible /models endpoint with a Bearer token; anthropic hits
* /v1/models with the x-api-key + anthropic-version headers, mirroring
* chatCompletionAnthropic's URL and auth handling.
* @param {string} apiKey
* @param {string} baseURL
* @param {string} protocol
* @param {string} proxyID
* @returns {$CancellablePromise<$models.ModelInfo[]>}
*/
function FetchModels(apiKey, baseURL, protocol, proxyID) {
	return ByID(2776454145, apiKey, baseURL, protocol, proxyID).then((($result) => {
		return $$createType31($result);
	}));
}
/**
* @param {string} path
* @returns {$CancellablePromise<number>}
*/
function FileSize(path) {
	return ByID(2529888714, path);
}
/**
* FrontendLog writes a frontend log message to the application log file.
* This is the canonical interface for the frontend to persist debug/audit
* messages alongside backend logs.
* @param {string} tag
* @param {string} message
* @returns {$CancellablePromise<void>}
*/
function FrontendLog(tag, message) {
	return ByID(956996769, tag, message);
}
/**
* @returns {$CancellablePromise<platform$0.FontInfo[]>}
*/
function GetAllFonts() {
	return ByID(2928968584).then((($result) => {
		return $$createType33($result);
	}));
}
/**
* @returns {$CancellablePromise<$models.AppInfo>}
*/
function GetAppInfo() {
	return ByID(713661858).then((($result) => {
		return $$createType34($result);
	}));
}
/**
* @returns {$CancellablePromise<string[]>}
*/
function GetAvailableShells() {
	return ByID(2833660057).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* GetBackgroundImage reads the stored background file and returns it as a
* data URL. Returns an empty string (no error) when name is empty or the
* file is missing, so the frontend degrades gracefully.
* @param {string} name
* @returns {$CancellablePromise<string>}
*/
function GetBackgroundImage(name) {
	return ByID(3678050968, name);
}
/**
* @param {string} name
* @returns {$CancellablePromise<string>}
*/
function GetCommandBody(name) {
	return ByID(193774856, name);
}
/**
* @returns {$CancellablePromise<$models.CredentialStatus>}
*/
function GetCredentialStatus() {
	return ByID(54415304).then((($result) => {
		return $$createType35($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<database$0.DBCapabilities>}
*/
function GetDBCapabilities(sessionID) {
	return ByID(3348276987, sessionID).then((($result) => {
		return $$createType36($result);
	}));
}
/**
* GetDataDirInfo returns the current data directory info for the settings tab.
* @returns {$CancellablePromise<$models.DataDirInfo>}
*/
function GetDataDirInfo() {
	return ByID(2590505350).then((($result) => {
		return $$createType38($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<string[]>}
*/
function GetDatabases(sessionID) {
	return ByID(2970679019, sessionID).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* GetDefaultSessionLogDir returns the directory a fresh session log
* would land in: the user's override if set, otherwise the OS default
* (~/Documents/ai-ops-terminal/logs on all platforms). Used by the settings UI
* to show the current default path as a placeholder.
* @returns {$CancellablePromise<string>}
*/
function GetDefaultSessionLogDir() {
	return ByID(1309090349);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.DeviceInfo[]>}
*/
function GetDevices(sessionID) {
	return ByID(2647233474, sessionID).then((($result) => {
		return $$createType40($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.DiskInfo[]>}
*/
function GetDisks(sessionID) {
	return ByID(2894712695, sessionID).then((($result) => {
		return $$createType42($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.FruInfo | null>}
*/
function GetHardwareFru(sessionID) {
	return ByID(3899203594, sessionID).then((($result) => {
		return $$createType44($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.LanField[]>}
*/
function GetHardwareLan(sessionID) {
	return ByID(1071370610, sessionID).then((($result) => {
		return $$createType46($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.HardwareSensors | null>}
*/
function GetHardwareSensors(sessionID) {
	return ByID(4235073158, sessionID).then((($result) => {
		return $$createType48($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.NetCardInfo[]>}
*/
function GetNetworkCards(sessionID) {
	return ByID(2292596022, sessionID).then((($result) => {
		return $$createType50($result);
	}));
}
/**
* @returns {$CancellablePromise<string>}
*/
function GetPlatform() {
	return ByID(3709063056);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.PortInfo[]>}
*/
function GetPorts(sessionID) {
	return ByID(2608014577, sessionID).then((($result) => {
		return $$createType52($result);
	}));
}
/**
* @param {string} sessionID
* @param {number} pid
* @returns {$CancellablePromise<{ [_ in string]?: any }>}
*/
function GetProcessDetail(sessionID, pid) {
	return ByID(1545588045, sessionID, pid).then((($result) => {
		return $$createType37($result);
	}));
}
/**
* @returns {$CancellablePromise<string[]>}
*/
function GetRecentConnections() {
	return ByID(2371696781).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} name
* @returns {$CancellablePromise<{ [_ in string]?: string }>}
*/
function GetServiceDetail(sessionID, name) {
	return ByID(1759677315, sessionID, name).then((($result) => {
		return $$createType53($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} name
* @param {number} lines
* @returns {$CancellablePromise<string>}
*/
function GetServiceLogs(sessionID, name, lines) {
	return ByID(4253359345, sessionID, name, lines);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.ServiceInfo[]>}
*/
function GetServices(sessionID) {
	return ByID(839930963, sessionID).then((($result) => {
		return $$createType55($result);
	}));
}
/**
* GetSessionOutputLogInfo returns the current log state for a panel.
* Returns zero value when the panel has no active log.
* @param {string} panelID
* @returns {$CancellablePromise<$models.SessionLogInfo>}
*/
function GetSessionOutputLogInfo(panelID) {
	return ByID(157929066, panelID).then((($result) => {
		return $$createType56($result);
	}));
}
/**
* @param {string} name
* @returns {$CancellablePromise<string>}
*/
function GetSkillBody(name) {
	return ByID(2818225280, name);
}
/**
* @param {string} name
* @param {string} relPath
* @returns {$CancellablePromise<string>}
*/
function GetSkillFile(name, relPath) {
	return ByID(1210351410, name, relPath);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @returns {$CancellablePromise<database$0.SchemaResult | null>}
*/
function GetTableSchema(sessionID, dbName, tableName) {
	return ByID(1047883138, sessionID, dbName, tableName).then((($result) => {
		return $$createType58($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} dbName
* @returns {$CancellablePromise<database$0.TableInfo[]>}
*/
function GetTables(sessionID, dbName) {
	return ByID(3495117462, sessionID, dbName).then((($result) => {
		return $$createType60($result);
	}));
}
/**
* @param {string} srcDir
* @returns {$CancellablePromise<string>}
*/
function ImportSkillFromDir(srcDir) {
	return ByID(1246178408, srcDir);
}
/**
* @param {string} zipPath
* @returns {$CancellablePromise<string>}
*/
function ImportSkillFromZip(zipPath) {
	return ByID(682671168, zipPath);
}
/**
* K8sConnect 建立到 kubeconfig 中指定 context 的连接，返回 connID。
* 若 tunnelSSHConnID 非空，会先起一条 SSH 隧道，把到 apiserver 的 TCP 拨号
* 劫持到本地 loopback；TLS 校验仍按 kubeconfig 里的原 hostname 走。
* @param {string} source
* @param {boolean} sourceIsPath
* @param {string} contextName
* @param {string} tunnelSSHConnID
* @param {string} tunnelSSHUser
* @param {string} tunnelSSHPassword
* @returns {$CancellablePromise<string>}
*/
function K8sConnect(source, sourceIsPath, contextName, tunnelSSHConnID, tunnelSSHUser, tunnelSSHPassword) {
	return ByID(1024416539, source, sourceIsPath, contextName, tunnelSSHConnID, tunnelSSHUser, tunnelSSHPassword);
}
/**
* @param {string} connID
* @returns {$CancellablePromise<void>}
*/
function K8sDisconnect(connID) {
	return ByID(2266030269, connID);
}
/**
* @param {string} connID
* @param {string} $namespace
* @param {string} pod
* @param {string} container
* @returns {$CancellablePromise<session$0.SessionInfo | null>}
*/
function K8sExecSession(connID, $namespace, pod, container) {
	return ByID(4010692254, connID, $namespace, pod, container).then((($result) => {
		return $$createType3($result);
	}));
}
/**
* K8sListContexts 解析给定 kubeconfig 内容并返回 context 列表。
* source 为文件路径或 YAML 内联字符串；根据 sourceIsPath 区分。
* @param {string} source
* @param {boolean} sourceIsPath
* @returns {$CancellablePromise<$models.K8sContextInfo[]>}
*/
function K8sListContexts(source, sourceIsPath) {
	return ByID(122681839, source, sourceIsPath).then((($result) => {
		return $$createType62($result);
	}));
}
/**
* @param {string} connID
* @param {string} method
* @param {string} path
* @param {string} body
* @param {string} contentType
* @returns {$CancellablePromise<$models.K8sResponse>}
*/
function K8sRequest(connID, method, path, body, contentType) {
	return ByID(2356716200, connID, method, path, body, contentType).then((($result) => {
		return $$createType63($result);
	}));
}
/**
* @param {string} connID
* @param {string} $namespace
* @param {string} pod
* @param {string} container
* @param {number} tailLines
* @param {boolean} timestamps
* @param {boolean} previous
* @returns {$CancellablePromise<string>}
*/
function K8sStartLogStream(connID, $namespace, pod, container, tailLines, timestamps, previous) {
	return ByID(3020817601, connID, $namespace, pod, container, tailLines, timestamps, previous);
}
/**
* @param {string} connID
* @param {string} path
* @returns {$CancellablePromise<string>}
*/
function K8sStartWatch(connID, path) {
	return ByID(2879011424, connID, path);
}
/**
* @param {string} streamID
* @returns {$CancellablePromise<void>}
*/
function K8sStopLogStream(streamID) {
	return ByID(535855231, streamID);
}
/**
* @param {string} watchID
* @returns {$CancellablePromise<void>}
*/
function K8sStopWatch(watchID) {
	return ByID(2276658246, watchID);
}
/**
* @param {string} sessionID
* @param {number} pid
* @param {string} signal
* @returns {$CancellablePromise<void>}
*/
function KillProcess(sessionID, pid, signal) {
	return ByID(3563357326, sessionID, pid, signal);
}
/**
* @returns {$CancellablePromise<store$0.CommandMeta[]>}
*/
function ListCommands() {
	return ByID(268986959).then((($result) => {
		return $$createType65($result);
	}));
}
/**
* ListExternalEditors scans the host for installed text editors and returns
* only the ones actually available, so the settings dropdown doesn't list
* editors that aren't installed here. detectExternalEditors is implemented per
* platform (app_windows.go / app_darwin.go / app_linux.go), since each OS
* offers a different set of editors.
* @returns {$CancellablePromise<$models.ExternalEditorOption[]>}
*/
function ListExternalEditors() {
	return ByID(4076692316).then((($result) => {
		return $$createType67($result);
	}));
}
/**
* ListSerialPorts returns available serial port names.
* @returns {$CancellablePromise<string[]>}
*/
function ListSerialPorts() {
	return ByID(3298629127).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* @returns {$CancellablePromise<session$0.SessionInfo[]>}
*/
function ListSessions() {
	return ByID(827108744).then((($result) => {
		return $$createType68($result);
	}));
}
/**
* @param {string} name
* @returns {$CancellablePromise<store$0.SkillFileList>}
*/
function ListSkillFiles(name) {
	return ByID(263357093, name).then((($result) => {
		return $$createType69($result);
	}));
}
/**
* @returns {$CancellablePromise<store$0.SkillMeta[]>}
*/
function ListSkills() {
	return ByID(1140726611).then((($result) => {
		return $$createType71($result);
	}));
}
/**
* ListTunnelStates returns the runtime state of every known tunnel.
* @returns {$CancellablePromise<session$0.TunnelState[]>}
*/
function ListTunnelStates() {
	return ByID(2477991997).then((($result) => {
		return $$createType73($result);
	}));
}
/**
* @returns {$CancellablePromise<store$0.AIConfig>}
*/
function LoadAIConfig() {
	return ByID(1957397801).then((($result) => {
		return $$createType74($result);
	}));
}
/**
* @returns {$CancellablePromise<store$0.AISessionData>}
*/
function LoadAISessions() {
	return ByID(1504881602).then((($result) => {
		return $$createType75($result);
	}));
}
/**
* @returns {$CancellablePromise<session$0.ConnectionStoreData>}
*/
function LoadConnections() {
	return ByID(631624218).then((($result) => {
		return $$createType76($result);
	}));
}
/**
* @returns {$CancellablePromise<session$0.IdentityStoreData>}
*/
function LoadIdentities() {
	return ByID(2632756951).then((($result) => {
		return $$createType77($result);
	}));
}
/**
* @returns {$CancellablePromise<store$0.LocalState>}
*/
function LoadLocalState() {
	return ByID(3577215577).then((($result) => {
		return $$createType78($result);
	}));
}
/**
* @returns {$CancellablePromise<session$0.ProxyStoreData>}
*/
function LoadProxies() {
	return ByID(2983464127).then((($result) => {
		return $$createType79($result);
	}));
}
/**
* @returns {$CancellablePromise<store$0.QuickCommandData>}
*/
function LoadQuickCommands() {
	return ByID(2697498502).then((($result) => {
		return $$createType80($result);
	}));
}
/**
* @returns {$CancellablePromise<store$0.AppSettings>}
*/
function LoadSettings() {
	return ByID(3551729052).then((($result) => {
		return $$createType81($result);
	}));
}
/**
* @returns {$CancellablePromise<store$0.HistoryEntry[]>}
*/
function LoadTerminalHistory() {
	return ByID(1861061311).then((($result) => {
		return $$createType83($result);
	}));
}
/**
* @returns {$CancellablePromise<session$0.TunnelStoreData>}
*/
function LoadTunnels() {
	return ByID(3310171584).then((($result) => {
		return $$createType84($result);
	}));
}
/**
* MCPCallTool invokes a single tool on the named MCP server. The result is
* returned as a generic value (the MCP content array) so the frontend can
* interpret it per the spec.
* @param {string} serverName
* @param {string} toolName
* @param {{ [_ in string]?: any }} args
* @returns {$CancellablePromise<any>}
*/
function MCPCallTool(serverName, toolName, args) {
	return ByID(938835349, serverName, toolName, args);
}
/**
* MCPListServers returns the names of all currently connected MCP servers.
* @returns {$CancellablePromise<string[]>}
*/
function MCPListServers() {
	return ByID(2786061817).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* MCPListTools calls the named server's tools/list method and returns the
* declared tools. The frontend uses this to register MCP tools into the
* toolRegistry so the AI can call them.
* @param {string} serverName
* @returns {$CancellablePromise<mcp$0.MCPToolInfo[]>}
*/
function MCPListTools(serverName) {
	return ByID(1078383626, serverName).then((($result) => {
		return $$createType86($result);
	}));
}
/**
* MCPStartServer launches an MCP server as a child process and registers it
* under `name`. A server with the same name is stopped first so the caller
* can re-connect. The frontend calls this from the MCP Servers settings card.
* @param {string} name
* @param {string} command
* @param {string[]} args
* @param {{ [_ in string]?: string }} env
* @returns {$CancellablePromise<void>}
*/
function MCPStartServer(name, command, args, env) {
	return ByID(3363319502, name, command, args, env);
}
/**
* MCPStopServer terminates the named MCP server and removes it from the
* registry. Idempotent — returns nil for unknown names.
* @param {string} name
* @returns {$CancellablePromise<void>}
*/
function MCPStopServer(name) {
	return ByID(3218464672, name);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @param {database$0.ColumnDef} col
* @returns {$CancellablePromise<void>}
*/
function ModifyColumn(sessionID, dbName, tableName, col) {
	return ByID(3589615025, sessionID, dbName, tableName, col);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} collection
* @returns {$CancellablePromise<void>}
*/
function MongoCreateCollection(sessionID, dbName, collection) {
	return ByID(531850823, sessionID, dbName, collection);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} collection
* @param {string} name
* @param {string[]} keys
* @param {boolean} unique
* @returns {$CancellablePromise<void>}
*/
function MongoCreateIndex(sessionID, dbName, collection, name, keys, unique) {
	return ByID(2790140205, sessionID, dbName, collection, name, keys, unique);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} collection
* @param {string} filterJSON
* @returns {$CancellablePromise<void>}
*/
function MongoDeleteOne(sessionID, dbName, collection, filterJSON) {
	return ByID(1315688832, sessionID, dbName, collection, filterJSON);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} collection
* @returns {$CancellablePromise<void>}
*/
function MongoDropCollection(sessionID, dbName, collection) {
	return ByID(3795415358, sessionID, dbName, collection);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @returns {$CancellablePromise<void>}
*/
function MongoDropDatabase(sessionID, dbName) {
	return ByID(4209814475, sessionID, dbName);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} collection
* @param {string} name
* @returns {$CancellablePromise<void>}
*/
function MongoDropIndex(sessionID, dbName, collection, name) {
	return ByID(991833706, sessionID, dbName, collection, name);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} collection
* @param {string} filterJSON
* @param {number} skip
* @param {number} limit
* @returns {$CancellablePromise<session$0.MongoQueryResult | null>}
*/
function MongoFind(sessionID, dbName, collection, filterJSON, skip, limit) {
	return ByID(3868976420, sessionID, dbName, collection, filterJSON, skip, limit).then((($result) => {
		return $$createType88($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} collection
* @param {string} docJSON
* @returns {$CancellablePromise<string>}
*/
function MongoInsertOne(sessionID, dbName, collection, docJSON) {
	return ByID(2777071646, sessionID, dbName, collection, docJSON);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @returns {$CancellablePromise<string[]>}
*/
function MongoListCollections(sessionID, dbName) {
	return ByID(375679292, sessionID, dbName).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<string[]>}
*/
function MongoListDatabases(sessionID) {
	return ByID(1191175283, sessionID).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} collection
* @returns {$CancellablePromise<session$0.MongoIndexInfo[]>}
*/
function MongoListIndexes(sessionID, dbName, collection) {
	return ByID(2579541009, sessionID, dbName, collection).then((($result) => {
		return $$createType90($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} collection
* @param {string} filterJSON
* @param {string} updateJSON
* @returns {$CancellablePromise<void>}
*/
function MongoUpdateOne(sessionID, dbName, collection, filterJSON, updateJSON) {
	return ByID(3400408070, sessionID, dbName, collection, filterJSON, updateJSON);
}
/**
* @returns {$CancellablePromise<string>}
*/
function OpenDirectoryDialog() {
	return ByID(1188724780);
}
/**
* OpenExternalEditorLocal launches the configured external editor directly on
* a local file (used by the SFTP "local" pane). Unlike the remote flavour, no
* temp copy or auto-upload is involved: the file already lives on disk, so the
* editor edits it in place and the launch returns immediately.
* @param {string} localPath
* @param {string} editorCmd
* @returns {$CancellablePromise<void>}
*/
function OpenExternalEditorLocal(localPath, editorCmd) {
	return ByID(3250967646, localPath, editorCmd);
}
/**
* @returns {$CancellablePromise<string>}
*/
function OpenFileDialog() {
	return ByID(4196526771);
}
/**
* OpenFileDialogFiltered is like OpenFileDialog but restricts the picker to
* a single extension filter (e.g. for importing a specific file format).
* @param {string} title
* @param {string} filterDisplayName
* @param {string} filterPattern
* @returns {$CancellablePromise<string>}
*/
function OpenFileDialogFiltered(title, filterDisplayName, filterPattern) {
	return ByID(3549883428, title, filterDisplayName, filterPattern);
}
/**
* @returns {$CancellablePromise<string[]>}
*/
function OpenMultipleFilesDialog() {
	return ByID(4031060776).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* OpenPathInExplorer reveals the given file in the platform file
* manager. On Windows uses `explorer /select,<path>`; macOS uses
* `open -R`; Linux uses `xdg-open <dir>` (no selection semantic in
* xdg-open, so the parent directory is opened).
* @param {string} path
* @returns {$CancellablePromise<void>}
*/
function OpenPathInExplorer(path) {
	return ByID(456697210, path);
}
/**
* OpenPrivateKeyFile opens the private-key picker, reads the selected file's
* text and returns it for direct use with the "keyText" auth type (#720). The
* content is validated before returning; a passphrase-protected key is accepted
* (the user supplies its passphrase separately) but content that doesn't look
* like a PEM private key is rejected with an immediate error.
* @returns {$CancellablePromise<string>}
*/
function OpenPrivateKeyFile() {
	return ByID(2945450137);
}
/**
* ParseImportFile parses a third-party or own-format file into an ImportResult
* with regenerated ids. It does not write to the store.
* @param {string} format
* @param {string} srcPath
* @param {string} password
* @returns {$CancellablePromise<importer$0.ImportResult | null>}
*/
function ParseImportFile(format, srcPath, password) {
	return ByID(1100595503, format, srcPath, password).then((($result) => {
		return $$createType92($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<void>}
*/
function RDPHide(sessionID) {
	return ByID(2927406489, sessionID);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<void>}
*/
function RDPInvalidate(sessionID) {
	return ByID(183249980, sessionID);
}
/**
* RDPSetFullScreen toggles the ActiveX control's built-in full-screen mode.
* @param {string} sessionID
* @param {boolean} full
* @returns {$CancellablePromise<void>}
*/
function RDPSetFullScreen(sessionID, full) {
	return ByID(1290017726, sessionID, full);
}
/**
* @param {string} sessionID
* @param {number} x
* @param {number} y
* @param {number} w
* @param {number} h
* @returns {$CancellablePromise<void>}
*/
function RDPSetPosition(sessionID, x, y, w, h) {
	return ByID(3669035284, sessionID, x, y, w, h);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<void>}
*/
function RDPShow(sessionID) {
	return ByID(1494153384, sessionID);
}
/**
* RDPSnapshot captures the RDP session's current frame as a base64-encoded PNG.
* The frontend shows it as a frozen background in .rdp-area while the RDP window
* is hidden under an overlay (menu/dialog), so the area shows a snapshot instead
* of a black placeholder.
* @param {string} sessionID
* @returns {$CancellablePromise<string>}
*/
function RDPSnapshot(sessionID) {
	return ByID(3332442625, sessionID);
}
/**
* @param {string} path
* @returns {$CancellablePromise<string>}
*/
function ReadFileBase64(path) {
	return ByID(467254620, path);
}
/**
* @param {string} path
* @param {number} offset
* @param {number} length
* @returns {$CancellablePromise<string>}
*/
function ReadFileChunkBase64(path, offset, length) {
	return ByID(1061431775, path, offset, length);
}
/**
* @param {string} connId
* @returns {$CancellablePromise<void>}
*/
function RecordRecentConnection(connId) {
	return ByID(3546167687, connId);
}
/**
* RecorderDelete removes a cast file from disk. If the recording is open it
* is stopped first.
* @param {string} filePath
* @returns {$CancellablePromise<void>}
*/
function RecorderDelete(filePath) {
	return ByID(40335984, filePath);
}
/**
* RecorderGetContent reads the entire cast file as a string. The frontend
* player parses the header + data rows to drive xterm.js replay.
* @param {string} filePath
* @returns {$CancellablePromise<string>}
*/
function RecorderGetContent(filePath) {
	return ByID(61949818, filePath);
}
/**
* RecorderIsRecording reports whether filePath is currently being recorded.
* @param {string} filePath
* @returns {$CancellablePromise<boolean>}
*/
function RecorderIsRecording(filePath) {
	return ByID(50556354, filePath);
}
/**
* RecorderList returns metadata for every .cast file in the records
* directory, newest first.
* @returns {$CancellablePromise<recorder$0.RecordingInfo[]>}
*/
function RecorderList() {
	return ByID(2257959547).then((($result) => {
		return $$createType94($result);
	}));
}
/**
* RecorderStart creates a new cast v2 file under ~/.ai-ops-terminal/records/ and
* writes the JSON header. Returns the absolute file path the frontend should
* pass to subsequent RecorderWriteData / RecorderStop calls.
* @param {string} sessionID
* @param {number} width
* @param {number} height
* @returns {$CancellablePromise<string>}
*/
function RecorderStart(sessionID, width, height) {
	return ByID(969998337, sessionID, width, height);
}
/**
* RecorderStop flushes and closes the recording at filePath. Idempotent.
* @param {string} filePath
* @returns {$CancellablePromise<void>}
*/
function RecorderStop(filePath) {
	return ByID(3239004539, filePath);
}
/**
* RecorderWriteData appends one `[elapsed, "o", data]` row to the cast file
* at filePath. Called from the terminal session:data hook in BaseTerminal.vue.
* No-op (returns nil) if the path is not an open recording — the frontend
* data path must not error when a recording was stopped concurrently.
* @param {string} filePath
* @param {string} data
* @returns {$CancellablePromise<void>}
*/
function RecorderWriteData(filePath, data) {
	return ByID(899043366, filePath, data);
}
/**
* @param {string} sessionID
* @param {string} key
* @returns {$CancellablePromise<void>}
*/
function RedisDeleteKey(sessionID, key) {
	return ByID(4292275470, sessionID, key);
}
/**
* @param {string} sessionID
* @param {string} key
* @returns {$CancellablePromise<session$0.FieldEntry[]>}
*/
function RedisGetHashAll(sessionID, key) {
	return ByID(808411099, sessionID, key).then((($result) => {
		return $$createType96($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} key
* @returns {$CancellablePromise<session$0.RedisKeyInfo | null>}
*/
function RedisGetKeyInfo(sessionID, key) {
	return ByID(2582162515, sessionID, key).then((($result) => {
		return $$createType98($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} key
* @param {number} start
* @param {number} stop
* @returns {$CancellablePromise<string[]>}
*/
function RedisGetListRange(sessionID, key, start, stop) {
	return ByID(3595698021, sessionID, key, start, stop).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} key
* @returns {$CancellablePromise<string[]>}
*/
function RedisGetSetAll(sessionID, key) {
	return ByID(32563723, sessionID, key).then((($result) => {
		return $$createType9($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} key
* @param {string} min
* @param {string} max
* @returns {$CancellablePromise<session$0.ScoredMember[]>}
*/
function RedisGetSortedSetRange(sessionID, key, min, max) {
	return ByID(2042963768, sessionID, key, min, max).then((($result) => {
		return $$createType100($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} key
* @returns {$CancellablePromise<string>}
*/
function RedisGetString(sessionID, key) {
	return ByID(4121931729, sessionID, key);
}
/**
* @param {string} sessionID
* @param {string} key
* @param {string[]} fields
* @returns {$CancellablePromise<number>}
*/
function RedisHashDel(sessionID, key, fields) {
	return ByID(2060238721, sessionID, key, fields);
}
/**
* @param {string} sessionID
* @param {string} key
* @param {string} field
* @param {string} value
* @returns {$CancellablePromise<void>}
*/
function RedisHashSet(sessionID, key, field, value) {
	return ByID(2580948404, sessionID, key, field, value);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<{ [_ in `${number}`]?: number }>}
*/
function RedisKeyspaceInfo(sessionID) {
	return ByID(1651498563, sessionID).then((($result) => {
		return $$createType101($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} key
* @param {string} direction
* @returns {$CancellablePromise<string>}
*/
function RedisListPop(sessionID, key, direction) {
	return ByID(1864066043, sessionID, key, direction);
}
/**
* @param {string} sessionID
* @param {string} key
* @param {string} direction
* @param {string[]} values
* @returns {$CancellablePromise<number>}
*/
function RedisListPush(sessionID, key, direction, values) {
	return ByID(316073280, sessionID, key, direction, values);
}
/**
* @param {string} sessionID
* @param {string} pattern
* @param {number} cursor
* @param {number} count
* @returns {$CancellablePromise<session$0.ScanResult | null>}
*/
function RedisScanKeys(sessionID, pattern, cursor, count) {
	return ByID(2318223685, sessionID, pattern, cursor, count).then((($result) => {
		return $$createType103($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} key
* @param {string[]} members
* @returns {$CancellablePromise<number>}
*/
function RedisSetAdd(sessionID, key, members) {
	return ByID(4167715791, sessionID, key, members);
}
/**
* @param {string} sessionID
* @param {string} key
* @param {number} seconds
* @returns {$CancellablePromise<void>}
*/
function RedisSetKeyTTL(sessionID, key, seconds) {
	return ByID(3020761565, sessionID, key, seconds);
}
/**
* @param {string} sessionID
* @param {string} key
* @param {string[]} members
* @returns {$CancellablePromise<number>}
*/
function RedisSetRemove(sessionID, key, members) {
	return ByID(2834642276, sessionID, key, members);
}
/**
* @param {string} sessionID
* @param {string} key
* @param {string} value
* @returns {$CancellablePromise<void>}
*/
function RedisSetString(sessionID, key, value) {
	return ByID(4177271893, sessionID, key, value);
}
/**
* @param {string} sessionID
* @param {number} idx
* @returns {$CancellablePromise<void>}
*/
function RedisSwitchDB(sessionID, idx) {
	return ByID(1060220242, sessionID, idx);
}
/**
* @param {string} sessionID
* @param {string} key
* @param {session$0.ScoredMember[]} members
* @returns {$CancellablePromise<number>}
*/
function RedisZSetAdd(sessionID, key, members) {
	return ByID(1954609049, sessionID, key, members);
}
/**
* @param {string} sessionID
* @param {string} key
* @param {string[]} members
* @returns {$CancellablePromise<number>}
*/
function RedisZSetRemove(sessionID, key, members) {
	return ByID(1318131750, sessionID, key, members);
}
/**
* RegisterSessionForPanel binds a session to a panel and, if the panel
* already has an active log, attaches the log writer to the session so
* output starts landing in the log immediately. The frontend calls this
* right after CreateSession succeeds, and on every reconnect.
* 
* On the first Register for a panel (i.e. not a reconnect), if the
* session was created from a connection with LogOnConnect=true, the
* log is enabled automatically. Later Registers for the same panel
* never re-trigger — the user's manual stop is respected across
* reconnects for the life of the panel.
* @param {string} sessionID
* @param {string} panelID
* @returns {$CancellablePromise<void>}
*/
function RegisterSessionForPanel(sessionID, panelID) {
	return ByID(1585812755, sessionID, panelID);
}
/**
* RelaunchApp spawns a fresh instance, then quits the current one so settings
* that are fixed at startup (e.g. the window title bar) can take effect. The
* new process is started first; a delay lets it finish spawning and raise its
* own window to the foreground (see bringMainWindowToFront) before this instance
* exits — while this process is still the foreground process, which is what
* grants the new one set-foreground permission on Windows.
* @returns {$CancellablePromise<void>}
*/
function RelaunchApp() {
	return ByID(3454341022);
}
/**
* @returns {$CancellablePromise<void>}
*/
function ResetCredentials() {
	return ByID(3410120286);
}
/**
* @param {store$0.AIConfig} config
* @returns {$CancellablePromise<void>}
*/
function SaveAIConfig(config) {
	return ByID(587625032, config);
}
/**
* @param {store$0.AISessionData} data
* @returns {$CancellablePromise<void>}
*/
function SaveAISessions(data) {
	return ByID(25196371, data);
}
/**
* @param {string} name
* @param {string} description
* @param {string} argumentHint
* @param {string} body
* @returns {$CancellablePromise<void>}
*/
function SaveCommand(name, description, argumentHint, body) {
	return ByID(3158687641, name, description, argumentHint, body);
}
/**
* @param {session$0.ConnectionStoreData} data
* @returns {$CancellablePromise<void>}
*/
function SaveConnections(data) {
	return ByID(3554987265, data);
}
/**
* @param {string} defaultName
* @returns {$CancellablePromise<string>}
*/
function SaveFileDialog(defaultName) {
	return ByID(1166008166, defaultName);
}
/**
* SaveFileDialogFiltered is like SaveFileDialog but restricts the picker to
* a single extension filter (e.g. for exporting a specific file format).
* @param {string} title
* @param {string} defaultName
* @param {string} filterDisplayName
* @param {string} filterPattern
* @returns {$CancellablePromise<string>}
*/
function SaveFileDialogFiltered(title, defaultName, filterDisplayName, filterPattern) {
	return ByID(1612922433, title, defaultName, filterDisplayName, filterPattern);
}
/**
* @param {session$0.IdentityStoreData} data
* @returns {$CancellablePromise<void>}
*/
function SaveIdentities(data) {
	return ByID(3323757602, data);
}
/**
* @param {store$0.LocalState} state
* @returns {$CancellablePromise<void>}
*/
function SaveLocalState(state) {
	return ByID(3489144204, state);
}
/**
* @param {session$0.ProxyStoreData} data
* @returns {$CancellablePromise<void>}
*/
function SaveProxies(data) {
	return ByID(1656831124, data);
}
/**
* @param {store$0.QuickCommandData} data
* @returns {$CancellablePromise<void>}
*/
function SaveQuickCommands(data) {
	return ByID(3668174037, data);
}
/**
* @param {store$0.AppSettings} settings
* @returns {$CancellablePromise<void>}
*/
function SaveSettings(settings) {
	return ByID(1949631069, settings);
}
/**
* @param {string} name
* @param {string} description
* @param {string} body
* @returns {$CancellablePromise<void>}
*/
function SaveSkill(name, description, body) {
	return ByID(4120188397, name, description, body);
}
/**
* @param {store$0.HistoryEntry[]} entries
* @returns {$CancellablePromise<void>}
*/
function SaveTerminalHistory(entries) {
	return ByID(4045500832, entries);
}
/**
* @param {session$0.TunnelStoreData} data
* @returns {$CancellablePromise<void>}
*/
function SaveTunnels(data) {
	return ByID(2808346811, data);
}
/**
* @param {number} x
* @param {number} y
* @param {number} width
* @param {number} height
* @param {boolean} maximised
* @returns {$CancellablePromise<void>}
*/
function SaveWindowState(x, y, width, height, maximised) {
	return ByID(2713230737, x, y, width, height, maximised);
}
/**
* @param {string} sessionID
* @param {string} name
* @param {string} action
* @returns {$CancellablePromise<void>}
*/
function ServiceAction(sessionID, name, action) {
	return ByID(91487070, sessionID, name, action);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<void>}
*/
function SessionEndZmodem(sessionID) {
	return ByID(2346339948, sessionID);
}
/**
* @param {string} sessionID
* @param {number} cols
* @param {number} rows
* @returns {$CancellablePromise<void>}
*/
function SessionResize(sessionID, cols, rows) {
	return ByID(1978935095, sessionID, cols, rows);
}
/**
* SessionStart triggers the actual Connect() for terminal sessions
* (ssh, local, telnet, mosh, serial) whose Connect was deferred by
* CreateSession. The frontend calls this AFTER mounting the xterm
* terminal and measuring the real cols/rows, so the PTY is created at
* the correct dimensions from the first byte — no 80x24 default phase
* where Claude Code can draw tables at the wrong column count.
* @param {string} sessionID
* @param {session$0.ConnectionConfig} config
* @returns {$CancellablePromise<void>}
*/
function SessionStart(sessionID, config) {
	return ByID(2790120981, sessionID, config);
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<void>}
*/
function SessionStartZmodem(sessionID) {
	return ByID(1282845413, sessionID);
}
/**
* @param {string} sessionID
* @param {string} data
* @returns {$CancellablePromise<void>}
*/
function SessionWrite(sessionID, data) {
	return ByID(233607874, sessionID, data);
}
/**
* @param {string} sessionID
* @param {string} base64Data
* @returns {$CancellablePromise<void>}
*/
function SessionWriteBinary(sessionID, base64Data) {
	return ByID(2127869747, sessionID, base64Data);
}
/**
* SetBackgroundImage copies the chosen image into the app's backgrounds
* directory as a single fixed file (overwriting any previous one) and
* returns the stored file name. It does NOT touch local_state.json.
* @param {string} srcPath
* @returns {$CancellablePromise<string>}
*/
function SetBackgroundImage(srcPath) {
	return ByID(1990119516, srcPath);
}
/**
* @param {string} name
* @param {boolean} enabled
* @returns {$CancellablePromise<void>}
*/
function SetCommandEnabled(name, enabled) {
	return ByID(3308016073, name, enabled);
}
/**
* @param {string} name
* @param {boolean} locked
* @returns {$CancellablePromise<void>}
*/
function SetCommandLocked(name, locked) {
	return ByID(3480001838, name, locked);
}
/**
* SetDataDir selects the data directory (first-run) or changes it (migrate
* flag). Returns an error if the target is not writable or, for a non-migrate
* change into an existing dir, the new dir's credentials cannot be unlocked.
* @param {string} kind
* @param {string} customDir
* @param {boolean} migrate
* @returns {$CancellablePromise<void>}
*/
function SetDataDir(kind, customDir, migrate) {
	return ByID(3350208962, kind, customDir, migrate);
}
/**
* SetDefaultSessionLogDir installs a user-configured override for the
* directory used by new session logs. Empty clears the override and
* restores the OS default. Existing log files are not migrated; the
* change only affects logs enabled after this call.
* @param {string} dir
* @returns {$CancellablePromise<void>}
*/
function SetDefaultSessionLogDir(dir) {
	return ByID(1051607777, dir);
}
/**
* @param {string} sessionID
* @param {string} tab
* @returns {$CancellablePromise<void>}
*/
function SetMonitorActiveTab(sessionID, tab) {
	return ByID(1294252028, sessionID, tab);
}
/**
* @param {string} sessionID
* @param {boolean} paused
* @returns {$CancellablePromise<void>}
*/
function SetMonitorPaused(sessionID, paused) {
	return ByID(4289660661, sessionID, paused);
}
/**
* @param {string} name
* @param {boolean} enabled
* @returns {$CancellablePromise<void>}
*/
function SetSkillEnabled(name, enabled) {
	return ByID(958021321, name, enabled);
}
/**
* @param {string} name
* @param {boolean} locked
* @returns {$CancellablePromise<void>}
*/
function SetSkillLocked(name, locked) {
	return ByID(2674859054, name, locked);
}
/**
* @param {string} mode
* @param {string} masterPassword
* @returns {$CancellablePromise<void>}
*/
function SetupCredentials(mode, masterPassword) {
	return ByID(3767567432, mode, masterPassword);
}
/**
* @param {string} sessionID
* @param {string} taskID
* @returns {$CancellablePromise<void>}
*/
function SftpCancelTransfer(sessionID, taskID) {
	return ByID(3922802881, sessionID, taskID);
}
/**
* @param {string} sessionID
* @param {string} dir
* @returns {$CancellablePromise<session$0.FileListResult>}
*/
function SftpChangeLocalDir(sessionID, dir) {
	return ByID(4098138530, sessionID, dir).then((($result) => {
		return $$createType104($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} dir
* @returns {$CancellablePromise<session$0.FileListResult>}
*/
function SftpChangeRemoteDir(sessionID, dir) {
	return ByID(436024405, sessionID, dir).then((($result) => {
		return $$createType104($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} path
* @param {string} mode
* @returns {$CancellablePromise<void>}
*/
function SftpChmod(sessionID, path, mode) {
	return ByID(1723221745, sessionID, path, mode);
}
/**
* @param {string} sessionID
* @param {string} oldPath
* @param {string} newPath
* @returns {$CancellablePromise<void>}
*/
function SftpCopy(sessionID, oldPath, newPath) {
	return ByID(3522084141, sessionID, oldPath, newPath);
}
/**
* @param {string} sessionID
* @param {string} remotePath
* @param {string} localPath
* @param {boolean} recursive
* @returns {$CancellablePromise<string>}
*/
function SftpGet(sessionID, remotePath, localPath, recursive) {
	return ByID(3499173996, sessionID, remotePath, localPath, recursive);
}
/**
* @param {string} sessionID
* @param {string} remotePath
* @returns {$CancellablePromise<string>}
*/
function SftpGetContent(sessionID, remotePath) {
	return ByID(3299848313, sessionID, remotePath);
}
/**
* @param {string} sessionID
* @param {string} dir
* @returns {$CancellablePromise<session$0.FileListResult>}
*/
function SftpListLocal(sessionID, dir) {
	return ByID(3732875251, sessionID, dir).then((($result) => {
		return $$createType104($result);
	}));
}
/**
* @param {string} sessionID
* @returns {$CancellablePromise<session$0.FileItem[]>}
*/
function SftpListLocalDrives(sessionID) {
	return ByID(3530566542, sessionID).then((($result) => {
		return $$createType106($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} dir
* @returns {$CancellablePromise<session$0.FileListResult>}
*/
function SftpListRemote(sessionID, dir) {
	return ByID(3685880654, sessionID, dir).then((($result) => {
		return $$createType104($result);
	}));
}
/**
* @param {string} sessionID
* @param {string} oldPath
* @param {string} newPath
* @returns {$CancellablePromise<void>}
*/
function SftpLocalCopy(sessionID, oldPath, newPath) {
	return ByID(3863639314, sessionID, oldPath, newPath);
}
/**
* @param {string} sessionID
* @param {string} localPath
* @returns {$CancellablePromise<string>}
*/
function SftpLocalGetContent(sessionID, localPath) {
	return ByID(2805622946, sessionID, localPath);
}
/**
* @param {string} sessionID
* @param {string} dir
* @returns {$CancellablePromise<void>}
*/
function SftpLocalMkdir(sessionID, dir) {
	return ByID(2491852346, sessionID, dir);
}
/**
* @param {string} sessionID
* @param {string} oldPath
* @param {string} newPath
* @returns {$CancellablePromise<void>}
*/
function SftpLocalMove(sessionID, oldPath, newPath) {
	return ByID(2873964530, sessionID, oldPath, newPath);
}
/**
* @param {string} sessionID
* @param {string} localPath
* @param {string} contentBase64
* @param {string} encoding
* @returns {$CancellablePromise<void>}
*/
function SftpLocalPutContent(sessionID, localPath, contentBase64, encoding) {
	return ByID(4089558589, sessionID, localPath, contentBase64, encoding);
}
/**
* @param {string} sessionID
* @param {string} path
* @param {boolean} recursive
* @returns {$CancellablePromise<void>}
*/
function SftpLocalRemove(sessionID, path, recursive) {
	return ByID(4183007255, sessionID, path, recursive);
}
/**
* @param {string} sessionID
* @param {string} oldPath
* @param {string} newPath
* @returns {$CancellablePromise<void>}
*/
function SftpLocalRename(sessionID, oldPath, newPath) {
	return ByID(3351764097, sessionID, oldPath, newPath);
}
/**
* @param {string} sessionID
* @param {string} dir
* @returns {$CancellablePromise<void>}
*/
function SftpMakeDir(sessionID, dir) {
	return ByID(1008508577, sessionID, dir);
}
/**
* @param {string} sessionID
* @param {string} oldPath
* @param {string} newPath
* @returns {$CancellablePromise<void>}
*/
function SftpMove(sessionID, oldPath, newPath) {
	return ByID(1243485501, sessionID, oldPath, newPath);
}
/**
* SftpOpenExternalEditor opens a remote file in a configurable external editor
* and starts background auto-upload of changes back to the remote path.
* editorCmd is the program + any fixed flags (quoted paths allowed); the temp
* file path is appended as the final argument. Returns immediately once the
* editor has launched; progress is reported via "sftp:extedit" Wails events.
* @param {string} sessionID
* @param {string} remotePath
* @param {string} editorCmd
* @returns {$CancellablePromise<void>}
*/
function SftpOpenExternalEditor(sessionID, remotePath, editorCmd) {
	return ByID(1943277058, sessionID, remotePath, editorCmd);
}
/**
* @param {string} sessionID
* @param {string} taskID
* @returns {$CancellablePromise<void>}
*/
function SftpPauseTransfer(sessionID, taskID) {
	return ByID(3763481257, sessionID, taskID);
}
/**
* @param {string} sessionID
* @param {string} localPath
* @param {string} remotePath
* @param {boolean} recursive
* @returns {$CancellablePromise<string>}
*/
function SftpPut(sessionID, localPath, remotePath, recursive) {
	return ByID(515207649, sessionID, localPath, remotePath, recursive);
}
/**
* @param {string} sessionID
* @param {string} remotePath
* @param {string} contentBase64
* @param {string} encoding
* @returns {$CancellablePromise<void>}
*/
function SftpPutContent(sessionID, remotePath, contentBase64, encoding) {
	return ByID(1913623462, sessionID, remotePath, contentBase64, encoding);
}
/**
* @param {string} sessionID
* @param {string} path
* @param {boolean} recursive
* @returns {$CancellablePromise<void>}
*/
function SftpRemove(sessionID, path, recursive) {
	return ByID(2664696088, sessionID, path, recursive);
}
/**
* SftpRename renames a remote file or directory.
* @param {string} sessionID
* @param {string} oldPath
* @param {string} newPath
* @returns {$CancellablePromise<void>}
*/
function SftpRename(sessionID, oldPath, newPath) {
	return ByID(3014038834, sessionID, oldPath, newPath);
}
/**
* @param {string} sessionID
* @param {string} taskID
* @returns {$CancellablePromise<void>}
*/
function SftpResumeTransfer(sessionID, taskID) {
	return ByID(658170344, sessionID, taskID);
}
/**
* StartTunnel brings the tunnel with the given ID up and returns its state.
* @param {string} id
* @returns {$CancellablePromise<session$0.TunnelState>}
*/
function StartTunnel(id) {
	return ByID(1828690041, id).then((($result) => {
		return $$createType72($result);
	}));
}
/**
* StopTunnel tears down the tunnel with the given ID.
* @param {string} id
* @returns {$CancellablePromise<void>}
*/
function StopTunnel(id) {
	return ByID(956285503, id);
}
/**
* @param {string} targetMode
* @param {string} masterPassword
* @returns {$CancellablePromise<void>}
*/
function SwitchCredentialMode(targetMode, masterPassword) {
	return ByID(156338879, targetMode, masterPassword);
}
/**
* SyncChangePassword re-encrypts synced files with a new master password.
* @param {string} oldPassword
* @param {string} newPassword
* @returns {$CancellablePromise<void>}
*/
function SyncChangePassword(oldPassword, newPassword) {
	return ByID(2830792331, oldPassword, newPassword);
}
/**
* SyncConfigureRepo sets up a new or existing sync repository.
* @param {string} repoURL
* @param {string} username
* @param {string} token
* @param {string} masterPassword
* @returns {$CancellablePromise<sync$0.SyncResult | null>}
*/
function SyncConfigureRepo(repoURL, username, token, masterPassword) {
	return ByID(4123643486, repoURL, username, token, masterPassword).then((($result) => {
		return $$createType108($result);
	}));
}
/**
* SyncDeleteRepo removes the sync repository configuration.
* @returns {$CancellablePromise<void>}
*/
function SyncDeleteRepo() {
	return ByID(175125957);
}
/**
* @returns {$CancellablePromise<sync$0.SyncConfig>}
*/
function SyncGetConfig() {
	return ByID(3268971192).then((($result) => {
		return $$createType109($result);
	}));
}
/**
* SyncNow runs an immediate sync.
* @returns {$CancellablePromise<sync$0.SyncResult | null>}
*/
function SyncNow() {
	return ByID(2954670258).then((($result) => {
		return $$createType108($result);
	}));
}
/**
* SyncResolveConflict resolves a sync conflict.
* @param {boolean} useLocal
* @returns {$CancellablePromise<sync$0.SyncResult | null>}
*/
function SyncResolveConflict(useLocal) {
	return ByID(3721385904, useLocal).then((($result) => {
		return $$createType108($result);
	}));
}
/**
* SyncSaveConfig saves the sync configuration.
* @param {sync$0.SyncConfig} config
* @param {string} token
* @returns {$CancellablePromise<void>}
*/
function SyncSaveConfig(config, token) {
	return ByID(1832075421, config, token);
}
/**
* SyncTestConnection tests the repository connection.
* @returns {$CancellablePromise<void>}
*/
function SyncTestConnection() {
	return ByID(3874884966);
}
/**
* SyncVerifyPassword verifies the given password can decrypt the repo config.
* @param {string} password
* @param {string} username
* @param {string} token
* @returns {$CancellablePromise<void>}
*/
function SyncVerifyPassword(password, username, token) {
	return ByID(2395319386, password, username, token);
}
/**
* TestConnection returns a short human-readable description on success, or a
* readable error (never echoing the password) on failure.
* @param {session$0.ConnectionConfig} config
* @returns {$CancellablePromise<string>}
*/
function TestConnection(config) {
	return ByID(1257240193, config);
}
/**
* @param {string} sessionID
* @param {string} dbName
* @param {string} tableName
* @returns {$CancellablePromise<void>}
*/
function TruncateTable(sessionID, dbName, tableName) {
	return ByID(2607265665, sessionID, dbName, tableName);
}
/**
* @param {string} masterPassword
* @returns {$CancellablePromise<void>}
*/
function UnlockCredentials(masterPassword) {
	return ByID(1750378633, masterPassword);
}
/**
* UnregisterSession clears the session\u2192panel binding and detaches any
* writer from the session. The logger itself is unaffected: it stays on
* the panel, waiting for the next session (reconnect) to register.
* @param {string} sessionID
* @returns {$CancellablePromise<void>}
*/
function UnregisterSession(sessionID) {
	return ByID(495495477, sessionID);
}
/**
* @param {string} path
* @param {string} base64Data
* @returns {$CancellablePromise<void>}
*/
function WriteFileBase64(path, base64Data) {
	return ByID(4117449373, path, base64Data);
}
/**
* X11DesktopConnect starts an x11-desktop session: looks up the saved
* connection config (which carries its own SSH credentials), opens an
* SSH connection with X11 forwarding, and runs the chosen desktop
* command on the remote host. connectionID and sessionID are distinct
* UUIDs (the connection is the user's saved record; the session is the
* live runtime object created via CreateSession).
* @param {string} connectionID
* @param {string} sessionID
* @returns {$CancellablePromise<void>}
*/
function X11DesktopConnect(connectionID, sessionID) {
	return ByID(978510395, connectionID, sessionID);
}
var $$createType0 = UpdateInfo.createFrom;
var $$createType1 = Nullable($$createType0);
var $$createType2 = SessionInfo.createFrom;
var $$createType3 = Nullable($$createType2);
var $$createType4 = Image.createFrom;
var $$createType5 = Array$1($$createType4);
var $$createType6 = InspectResult.createFrom;
var $$createType7 = Container.createFrom;
var $$createType8 = Array$1($$createType7);
var $$createType9 = Array$1(Any);
Stats.createFrom;
var $$createType12 = EsClusterHealth$1.createFrom;
var $$createType13 = Nullable($$createType12);
var $$createType14 = EsClusterInfo$1.createFrom;
var $$createType15 = Nullable($$createType14);
var $$createType16 = EsIndexInfo.createFrom;
var $$createType17 = Array$1($$createType16);
EsNodeSummary.createFrom;
var $$createType20 = EsRestResult.createFrom;
var $$createType21 = Nullable($$createType20);
var $$createType22 = EsSearchResult.createFrom;
var $$createType23 = Nullable($$createType22);
var $$createType24 = QueryResult.createFrom;
var $$createType25 = Nullable($$createType24);
var $$createType26 = ScriptResult.createFrom;
var $$createType27 = Nullable($$createType26);
var $$createType28 = ExecResult.createFrom;
var $$createType29 = Nullable($$createType28);
var $$createType30 = ModelInfo.createFrom;
var $$createType31 = Array$1($$createType30);
var $$createType32 = FontInfo.createFrom;
var $$createType33 = Array$1($$createType32);
var $$createType34 = AppInfo.createFrom;
var $$createType35 = CredentialStatus.createFrom;
var $$createType36 = (function $$initCreateType36(...args) {
	if ($$createType36 === $$initCreateType36) $$createType36 = $$createType37;
	return $$createType36(...args);
});
var $$createType37 = Map$1(Any, Any);
var $$createType38 = DataDirInfo.createFrom;
var $$createType39 = DeviceInfo.createFrom;
var $$createType40 = Array$1($$createType39);
var $$createType41 = DiskInfo.createFrom;
var $$createType42 = Array$1($$createType41);
var $$createType43 = FruInfo.createFrom;
var $$createType44 = Nullable($$createType43);
var $$createType45 = LanField.createFrom;
var $$createType46 = Array$1($$createType45);
var $$createType47 = HardwareSensors.createFrom;
var $$createType48 = Nullable($$createType47);
var $$createType49 = NetCardInfo.createFrom;
var $$createType50 = Array$1($$createType49);
var $$createType51 = PortInfo.createFrom;
var $$createType52 = Array$1($$createType51);
var $$createType53 = Map$1(Any, Any);
var $$createType54 = ServiceInfo.createFrom;
var $$createType55 = Array$1($$createType54);
var $$createType56 = SessionLogInfo.createFrom;
var $$createType57 = SchemaResult.createFrom;
var $$createType58 = Nullable($$createType57);
var $$createType59 = TableInfo.createFrom;
var $$createType60 = Array$1($$createType59);
var $$createType61 = ContextInfo.createFrom;
var $$createType62 = Array$1($$createType61);
var $$createType63 = K8sResponse.createFrom;
var $$createType64 = CommandMeta.createFrom;
var $$createType65 = Array$1($$createType64);
var $$createType66 = ExternalEditorOption.createFrom;
var $$createType67 = Array$1($$createType66);
var $$createType68 = Array$1($$createType2);
var $$createType69 = SkillFileList.createFrom;
var $$createType70 = SkillMeta.createFrom;
var $$createType71 = Array$1($$createType70);
var $$createType72 = TunnelState.createFrom;
var $$createType73 = Array$1($$createType72);
var $$createType74 = AIConfig.createFrom;
var $$createType75 = AISessionData.createFrom;
var $$createType76 = ConnectionStoreData.createFrom;
var $$createType77 = IdentityStoreData.createFrom;
var $$createType78 = LocalState.createFrom;
var $$createType79 = ProxyStoreData.createFrom;
var $$createType80 = QuickCommandData.createFrom;
var $$createType81 = AppSettings.createFrom;
var $$createType82 = HistoryEntry.createFrom;
var $$createType83 = Array$1($$createType82);
var $$createType84 = TunnelStoreData.createFrom;
var $$createType85 = MCPToolInfo.createFrom;
var $$createType86 = Array$1($$createType85);
var $$createType87 = MongoQueryResult.createFrom;
var $$createType88 = Nullable($$createType87);
var $$createType89 = MongoIndexInfo.createFrom;
var $$createType90 = Array$1($$createType89);
var $$createType91 = ImportResult.createFrom;
var $$createType92 = Nullable($$createType91);
var $$createType93 = RecordingInfo.createFrom;
var $$createType94 = Array$1($$createType93);
var $$createType95 = FieldEntry.createFrom;
var $$createType96 = Array$1($$createType95);
var $$createType97 = RedisKeyInfo.createFrom;
var $$createType98 = Nullable($$createType97);
var $$createType99 = ScoredMember.createFrom;
var $$createType100 = Array$1($$createType99);
var $$createType101 = Map$1(Any, Any);
var $$createType102 = ScanResult.createFrom;
var $$createType103 = Nullable($$createType102);
var $$createType104 = FileListResult.createFrom;
var $$createType105 = FileItem.createFrom;
var $$createType106 = Array$1($$createType105);
var $$createType107 = SyncResult.createFrom;
var $$createType108 = Nullable($$createType107);
var $$createType109 = SyncConfig.createFrom;
//#endregion
export { EsGetMapping as $, Environment as $i, RecorderGetContent as $n, SetDataDir as $r, KillProcess as $t, CreateSession as A, SftpRename as Ai, MongoInsertOne as An, SaveCommand as Ar, GetPlatform as At, DropColumn as B, SyncResolveConflict as Bi, OpenPathInExplorer as Bn, SaveTerminalHistory as Br, GetTableSchema as Bt, ContainerSetNamespace as C, SftpMakeDir as Ci, MongoCreateCollection as Cn, RedisZSetAdd as Cr, GetDefaultSessionLogDir as Ct, CopyTable as D, SftpPut as Di, MongoDropDatabase as Dn, ResetCredentials as Dr, GetHardwareLan as Dt, ContainerStopStream as E, SftpPauseTransfer as Ei, MongoDropCollection as En, RelaunchApp as Er, GetHardwareFru as Et, DBInsertRow as F, SyncChangePassword as Fi, OpenDirectoryDialog as Fn, SaveLocalState as Fr, GetServiceLogs as Ft, DumpTable as G, TruncateTable as Gi, RDPSetFullScreen as Gn, SessionResize as Gr, K8sDisconnect as Gt, DropIndexOp as H, SyncTestConnection as Hi, ParseImportFile as Hn, SaveWindowState as Hr, ImportSkillFromDir as Ht, DBUpdateRow as I, SyncConfigureRepo as Ii, OpenExternalEditorLocal as In, SaveProxies as Ir, GetServices as It, EsClusterHealth as J, WriteFileBase64 as Ji, RDPSnapshot as Jn, SessionWrite as Jr, K8sRequest as Jt, EnableSessionOutputLog as K, UnlockCredentials as Ki, RDPSetPosition as Kn, SessionStart as Kr, K8sExecSession as Kt, DeleteCommand as L, SyncDeleteRepo as Li, OpenFileDialog as Ln, SaveQuickCommands as Lr, GetSessionOutputLogInfo as Lt, CreateTable as M, StartTunnel as Mi, MongoListDatabases as Mn, SaveFileDialog as Mr, GetProcessDetail as Mt, DBDefaultTableQuery as N, StopTunnel as Ni, MongoListIndexes as Nn, SaveFileDialogFiltered as Nr, GetRecentConnections as Nt, CreateCommand as O, SftpPutContent as Oi, MongoDropIndex as On, SaveAIConfig as Or, GetHardwareSensors as Ot, DBDeleteRow as P, SwitchCredentialMode as Pi, MongoUpdateOne as Pn, SaveIdentities as Pr, GetServiceDetail as Pt, EsDeleteIndex as Q, Events as Qi, RecorderDelete as Qn, SetCommandLocked as Qr, K8sStopWatch as Qt, DeleteSkill as R, SyncGetConfig as Ri, OpenFileDialogFiltered as Rn, SaveSettings as Rr, GetSkillBody as Rt, ContainerRename as S, SftpLocalRename as Si, ModifyColumn as Sn, RedisSwitchDB as Sr, GetDatabases as St, ContainerStartPull as T, SftpOpenExternalEditor as Ti, MongoDeleteOne as Tn, RegisterSessionForPanel as Tr, GetDisks as Tt, DropTable as U, SyncVerifyPassword as Ui, RDPHide as Un, ServiceAction as Ur, ImportSkillFromZip as Ut, DropDatabase as V, SyncSaveConfig as Vi, OpenPrivateKeyFile as Vn, SaveTunnels as Vr, GetTables as Vt, DropView as W, TestConnection as Wi, RDPInvalidate as Wn, SessionEndZmodem as Wr, K8sConnect as Wt, EsCreateIndex as X, SyncConfig as Xi, ReadFileChunkBase64 as Xn, SetBackgroundImage as Xr, K8sStartWatch as Xt, EsClusterInfo as Y, X11DesktopConnect as Yi, ReadFileBase64 as Yn, SessionWriteBinary as Yr, K8sStartLogStream as Yt, EsDeleteDoc as Z, thisWindow as Zi, RecordRecentConnection as Zn, SetCommandEnabled as Zr, K8sStopLogStream as Zt, ContainerImages as _, SftpLocalGetContent as _i, MCPCallTool as _n, RedisScanKeys as _r, GetBackgroundImage as _t, ApplyImport as a, SetupCredentials as ai, ListSkills as an, RedisDeleteKey as ar, EsSearch as at, ContainerNamespaces as b, SftpLocalPutContent as bi, MCPStartServer as bn, RedisSetRemove as br, GetDBCapabilities as bt, ChatCompletion as c, SftpChangeRemoteDir as ci, LoadAISessions as cn, RedisGetListRange as cr, ExecuteSQLScript as ct, CloseSession as d, SftpGet as di, LoadLocalState as dn, RedisGetString as dr, FetchModels as dt, newRuntimeCaller as ea, SetDefaultSessionLogDir as ei, ListCommands as en, RecorderIsRecording as er, EsGetSettings as et, ContainerAction as f, SftpGetContent as fi, LoadProxies as fn, RedisHashDel as fr, FileSize as ft, ContainerExecSession as g, SftpLocalCopy as gi, LoadTunnels as gn, RedisListPush as gr, GetAvailableShells as gt, ContainerDisconnect as h, SftpListRemote as hi, LoadTerminalHistory as hn, RedisListPop as hr, GetAppInfo as ht, AppendFileBase64 as i, SetSkillLocked as ii, ListSkillFiles as in, RecorderWriteData as ir, EsRest as it, CreateSkill as j, SftpResumeTransfer as ji, MongoListCollections as jn, SaveConnections as jr, GetPorts as jt, CreateDatabase as k, SftpRemove as ki, MongoFind as kn, SaveAISessions as kr, GetNetworkCards as kt, CheckForUpdate as l, SftpChmod as li, LoadConnections as ln, RedisGetSetAll as lr, ExecuteStatement as lt, ContainerCreate as m, SftpListLocalDrives as mi, LoadSettings as mn, RedisKeyspaceInfo as mr, GetAllFonts as mt, AddColumn as n, hasDOM as na, SetMonitorPaused as ni, ListSerialPorts as nn, RecorderStart as nr, EsListIndices as nt, CancelChatStream as o, SftpCancelTransfer as oi, ListTunnelStates as on, RedisGetHashAll as or, EsUpdateDoc as ot, ContainerConnect as p, SftpListLocal as pi, LoadQuickCommands as pn, RedisHashSet as pr, FrontendLog as pt, EsCloseIndex as q, UnregisterSession as qi, RDPShow as qn, SessionStartZmodem as qr, K8sListContexts as qt, AddIndex as r, SetSkillEnabled as ri, ListSessions as rn, RecorderStop as rr, EsOpenIndex as rt, ChangeMasterPassword as s, SftpChangeLocalDir as si, LoadAIConfig as sn, RedisGetKeyInfo as sr, ExecuteQuery as st, AcceptHostKeyChange as t, objectNames as ta, SetMonitorActiveTab as ti, ListExternalEditors as tn, RecorderList as tr, EsIndexDoc as tt, ClearBackgroundImage as u, SftpCopy as ui, LoadIdentities as un, RedisGetSortedSetRange as ur, ExportConnections as ut, ContainerInspect as v, SftpLocalMkdir as vi, MCPListServers as vn, RedisSetAdd as vr, GetCommandBody as vt, ContainerStartLogs as w, SftpMove as wi, MongoCreateIndex as wn, RedisZSetRemove as wr, GetDevices as wt, ContainerRemoveImage as x, SftpLocalRemove as xi, MCPStopServer as xn, RedisSetString as xr, GetDataDirInfo as xt, ContainerList as y, SftpLocalMove as yi, MCPListTools as yn, RedisSetKeyTTL as yr, GetCredentialStatus as yt, DisableSessionOutputLog as z, SyncNow as zi, OpenMultipleFilesDialog as zn, SaveSkill as zr, GetSkillFile as zt };
