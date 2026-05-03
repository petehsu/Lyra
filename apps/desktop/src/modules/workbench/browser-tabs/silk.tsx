/* eslint-disable react/no-unknown-property */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, type Mesh, type ShaderMaterial } from "three";

type SilkProps = {
  readonly speed?: number;
  readonly scale?: number;
  readonly color?: string;
  readonly noiseIntensity?: number;
  readonly rotation?: number;
  readonly animationEnabled?: boolean;
};

type SilkUniforms = {
  readonly uSpeed: { value: number };
  readonly uScale: { value: number };
  readonly uNoiseIntensity: { value: number };
  readonly uColor: { value: Color };
  readonly uRotation: { value: number };
  readonly uTime: { value: number };
};

const hexToNormalizedRGB = (hex: string): readonly [number, number, number] => {
  const normalized = hex.replace("#", "");
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255
  ];
};

const vertexShader = `
varying vec2 vUv;
varying vec3 vPosition;

void main() {
  vPosition = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
varying vec2 vUv;
varying vec3 vPosition;

uniform float uTime;
uniform vec3  uColor;
uniform float uSpeed;
uniform float uScale;
uniform float uRotation;
uniform float uNoiseIntensity;

const float e = 2.71828182845904523536;

float noise(vec2 texCoord) {
  float G = e;
  vec2  r = (G * sin(G * texCoord));
  return fract(r.x * r.y * (1.0 + texCoord.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2  rot = mat2(c, -s, s, c);
  return rot * uv;
}

void main() {
  float rnd        = noise(gl_FragCoord.xy);
  vec2  uv         = rotateUvs(vUv * uScale, uRotation);
  vec2  tex        = uv * uScale;
  float tOffset    = uSpeed * uTime;

  tex.y += 0.03 * sin(8.0 * tex.x - tOffset);

  float pattern = 0.6 +
                  0.4 * sin(5.0 * (tex.x + tex.y +
                                   cos(3.0 * tex.x + 5.0 * tex.y) +
                                   0.02 * tOffset) +
                           sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));

  vec4 col = vec4(uColor, 1.0) * vec4(pattern) - rnd / 15.0 * uNoiseIntensity;
  col.a = 1.0;
  gl_FragColor = col;
}
`;

const SILK_FRAME_INTERVAL_MS = 1000 / 30;

const SilkPlane = ({
  uniforms,
  animationEnabled
}: {
  readonly uniforms: SilkUniforms;
  readonly animationEnabled: boolean;
}) => {
  const meshRef = useRef<Mesh>(null);
  const { invalidate, viewport } = useThree();

  useLayoutEffect(() => {
    meshRef.current?.scale.set(viewport.width, viewport.height, 1);
    invalidate();
  }, [invalidate, viewport]);

  useEffect(() => {
    if (!animationEnabled) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      invalidate();
    }, SILK_FRAME_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [animationEnabled, invalidate]);

  useFrame((_, delta) => {
    if (!animationEnabled) {
      return;
    }
    const material = meshRef.current?.material as ShaderMaterial | undefined;
    if (material !== undefined) {
      (material.uniforms as SilkUniforms).uTime.value += 0.1 * delta;
    }
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1, 1, 1, 1]} />
      <shaderMaterial
        depthTest={false}
        depthWrite={false}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        vertexShader={vertexShader}
      />
    </mesh>
  );
};

const Silk = ({
  speed = 5,
  scale = 1,
  color = "#7B7481",
  noiseIntensity = 1.5,
  rotation = 0,
  animationEnabled = true
}: SilkProps) => {
  const uniforms = useMemo<SilkUniforms>(
    () => ({
      uSpeed: { value: speed },
      uScale: { value: scale },
      uNoiseIntensity: { value: noiseIntensity },
      uColor: { value: new Color(...hexToNormalizedRGB(color)) },
      uRotation: { value: rotation },
      uTime: { value: 0 }
    }),
    [color, noiseIntensity, rotation, scale, speed]
  );

  return (
    <Canvas
      camera={{ position: [0, 0, 1] }}
      dpr={[1, 1]}
      flat
      frameloop={animationEnabled ? "demand" : "never"}
      gl={{
        alpha: false,
        antialias: false,
        depth: false,
        powerPreference: "low-power",
        preserveDrawingBuffer: false,
        stencil: false
      }}
      linear
    >
      <SilkPlane animationEnabled={animationEnabled} uniforms={uniforms} />
    </Canvas>
  );
};

export default Silk;
