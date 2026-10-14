// PDF.js also runs inside a Worker, whose globals are separate from the WebView.
// Load standards-based polyfills in both contexts before loading PDF.js.
import 'core-js/actual/index.js';
