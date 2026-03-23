# Stride kinematics (vision pipeline)

Browser app: **MediaPipe Pose Landmarker (BlazePose)** → **constant-acceleration Kalman** with
visibility-dependent measurement noise → optional **RTS smoother** (offline) → **geometric joint
angles**, stride heuristics, and export.

This matches the vision + filtering parts of a MediaPipe/MuJoCo hybrid workflow described in
`Kinematics Estimation Analysis.md`. **MuJoCo mocap IK, physics limits, damping, and trajectory
optimization are not in this repo** (would require a native or WASM physics backend).

**Capture:** prefer **120+ fps** for sprint-style motion; the analyzer warns when FPS is low and
can read an approximate rate from the video track when the browser exposes it. Optional **field
width (meters)** calibrates normalized coordinates using a known horizontal span across the frame.
