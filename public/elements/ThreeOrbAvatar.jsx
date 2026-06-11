import { useEffect, useRef } from "react";

export default function ThreeOrbAvatar() {
  const hostRef = useRef(null);
  const size = props.size || 160;
  const preset = props.preset || "Default";

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !window.ArchiveThreeOrbAvatar) {
      return undefined;
    }

    let cleanup = function noop() {};

    window.ArchiveThreeOrbAvatar.mountThreeOrb(host, size, { preset }).then(
      function (stop) {
        cleanup = stop || cleanup;
      }
    );

    return function () {
      cleanup();
    };
  }, [size, preset]);

  return (
    <div
      ref={hostRef}
      className="three-orb-avatar-wrapper inline-flex items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
