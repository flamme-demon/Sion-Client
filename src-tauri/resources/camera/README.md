Models bundled with the Sion webcam effects engine
================================================

person.onnx — MediaPipe Selfie Segmentation, ONNX Community export (Apache-2.0)
Source: https://huggingface.co/onnx-community/mediapipe_selfie_segmentation
Revision: be49485c8e027524be38591817fc5cd31bd9d00e
File: onnx/model.onnx (float32)
SHA-256: 3241ac4ad8aa35bdaf33946776db29f7c283a413aa0b0dacb9483594b4531aad
Input: RGB float32 [1, 3, 256, 256], values in [0, 1].
Output: person probabilities [1, 1, 256, 256].

face.onnx — OpenCV Zoo YuNet 2023mar (MIT)
Source: https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
SHA-256: 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4

Weights are unchanged and embedded in the native binary. Shape annotations are
recalculated in memory for a single image (and 320x320 for YuNet). Inference runs
locally with Tract. Each person mask is applied only to the image it analyzed;
face tracking runs separately and cannot hold up background segmentation.

The complete licenses are also shipped as resources/camera-NOTICES.txt.
