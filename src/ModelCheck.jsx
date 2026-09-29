import { useEffect } from "react";
import * as ort from "onnxruntime-web";

export default function ModelCheck() {
  useEffect(() => {
    async function verifyModel() {
      try {
        const session = await ort.InferenceSession.create(
          "/models/digit_cnn.onnx",
          { executionProviders: ["wasm"] },
        );

        console.log("Model loaded");
        console.log("Inputs:", session.inputNames);
        console.log("Outputs:", session.outputNames);

        const input = new ort.Tensor(
          "float32",
          new Float32Array(1 * 1 * 32 * 32),
          [1, 1, 32, 32],
        );

        const result = await session.run({
          [session.inputNames[0]]: input,
        });

        console.log("Inference output:", result);
      } catch (error) {
        console.error("ONNX model failed:", error);
      }
    }

    verifyModel();
  }, []);

  return <p>Check the browser console.</p>;
}
