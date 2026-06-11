import { useEffect, useRef } from "react";

export default function OrbAvatar() {
  const canvasRef = useRef(null);
  const size = props.size || 160;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !window.ArchiveOrbAvatar) {
      return undefined;
    }

    return window.ArchiveOrbAvatar.mount(canvas, size);
  }, [size]);

  return (
    <div
      className="orb-avatar-wrapper inline-flex items-center justify-center overflow-hidden rounded-full bg-black"
      style={{ width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        className="orb-avatar-canvas"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    </div>
  );
}
