import type { CSSProperties, SVGProps } from "react";

type GarmentKind = "top" | "pants" | "shoes";

interface GarmentConfig {
  id: string;
  kind: GarmentKind;
  floatX: string;
  floatY: string;
  floatR: string;
  targetX: string;
  targetY: string;
  delay: string;
  tone: string;
}

type MotionStyle = CSSProperties & {
  "--float-x": string;
  "--float-y": string;
  "--float-r": string;
  "--target-x": string;
  "--target-y": string;
  "--delay": string;
  "--tone": string;
};

const garments: GarmentConfig[] = [
  {
    id: "top",
    kind: "top",
    floatX: "-190px",
    floatY: "-105px",
    floatR: "-16deg",
    targetX: "0px",
    targetY: "-26px",
    delay: "0s",
    tone: "#8f5f34"
  },
  {
    id: "pants",
    kind: "pants",
    floatX: "188px",
    floatY: "-62px",
    floatR: "15deg",
    targetX: "0px",
    targetY: "66px",
    delay: "0.8s",
    tone: "#6f7d8e"
  },
  {
    id: "shoes",
    kind: "shoes",
    floatX: "-170px",
    floatY: "132px",
    floatR: "-10deg",
    targetX: "0px",
    targetY: "182px",
    delay: "1.6s",
    tone: "#9f744b"
  }
];

function TopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 84 84" fill="none" aria-hidden="true" {...props}>
      <path
        d="M25 20L16 28L24 39V63H60V39L68 28L59 20L51 28H33L25 20Z"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PantsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 84 84" fill="none" aria-hidden="true" {...props}>
      <path d="M23 18H61L57 66H44L42 50L40 66H27L23 18Z" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
    </svg>
  );
}

function ShoesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 84 84" fill="none" aria-hidden="true" {...props}>
      <path
        d="M16 52H68V59C68 62.3 65.3 65 62 65H22C18.7 65 16 62.3 16 59V52Z"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path d="M24 52L32 38L45 42L52 52" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

function GarmentIcon({ kind, className }: { kind: GarmentKind; className?: string }) {
  if (kind === "top") {
    return <TopIcon className={className} />;
  }

  if (kind === "pants") {
    return <PantsIcon className={className} />;
  }

  return <ShoesIcon className={className} />;
}

export function HeroWardrobeAnimation() {
  return (
    <div className="hero-wardrobe" aria-hidden="true">
      <div className="hero-wardrobe__grain" />
      <div className="hero-wardrobe__aura hero-wardrobe__aura--left" />
      <div className="hero-wardrobe__aura hero-wardrobe__aura--right" />
      <div className="hero-wardrobe__aura hero-wardrobe__aura--bottom" />
      <span className="hero-wardrobe__spark hero-wardrobe__spark--1" />
      <span className="hero-wardrobe__spark hero-wardrobe__spark--2" />
      <span className="hero-wardrobe__spark hero-wardrobe__spark--3" />
      <span className="hero-wardrobe__spark hero-wardrobe__spark--4" />

      <div className="hero-status">
        <span className="hero-status__float">Your garments float into view.</span>
        <span className="hero-status__fit">AI assembles the look on your model.</span>
      </div>

      <div className="hero-model">
        <div className="hero-model__head" />
        <div className="hero-model__torso" />
        <div className="hero-model__legs">
          <span />
          <span />
        </div>
      </div>

      {garments.map((garment) => {
        const style: MotionStyle = {
          "--float-x": garment.floatX,
          "--float-y": garment.floatY,
          "--float-r": garment.floatR,
          "--target-x": garment.targetX,
          "--target-y": garment.targetY,
          "--delay": garment.delay,
          "--tone": garment.tone,
          animationDelay: garment.delay
        };

        return (
          <div key={`${garment.id}-floating`} style={style} className="hero-garment">
            <GarmentIcon kind={garment.kind} className="hero-garment__icon" />
          </div>
        );
      })}

      {garments.map((garment) => {
        const style: MotionStyle = {
          "--float-x": garment.floatX,
          "--float-y": garment.floatY,
          "--float-r": garment.floatR,
          "--target-x": garment.targetX,
          "--target-y": garment.targetY,
          "--delay": garment.delay,
          "--tone": garment.tone,
          animationDelay: garment.delay
        };

        return (
          <div key={`${garment.id}-fitted`} style={style} className="hero-fitted">
            <GarmentIcon kind={garment.kind} className="hero-fitted__icon" />
          </div>
        );
      })}

      <div className="hero-wardrobe__runway" />
    </div>
  );
}
