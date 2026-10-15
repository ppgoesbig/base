# Third-party files

These files power PureFrame's on-device AI cut-out. They are shipped
unmodified and loaded only when a photo needs background removal.

| File | What it is | Source | License |
|---|---|---|---|
| `ort.wasm.bundle.min.mjs` | ONNX Runtime Web 1.30.0, WebAssembly CPU build | npm `onnxruntime-web@1.30.0` (`dist/`) | MIT (`LICENSE-onnxruntime-web.txt`) |
| `ort-wasm-simd-threaded.wasm` | ONNX Runtime Web 1.30.0 WebAssembly binary | npm `onnxruntime-web@1.30.0` (`dist/`) | MIT (`LICENSE-onnxruntime-web.txt`) |
| `u2netp.onnx` | U-2-Netp salient object segmentation model (Qin et al., 2020) | npm `@planby-tech/rmbg-webgpu@0.2.1` (`models/u2netp.onnx`), originally the rembg release of the model from https://github.com/xuebinqin/U-2-Net | Apache-2.0 (`LICENSE-U2Net-Apache-2.0.txt`) |

SHA-256:

```
3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2  ort-wasm-simd-threaded.wasm
11e64bd8ffe11bd1a2a2f0d6275fdfbbba7262f0b76b99b53d228a8a22ef3d90  ort.wasm.bundle.min.mjs
309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8  u2netp.onnx
```

Keep this file and the license texts with any copy of the model or runtime.
