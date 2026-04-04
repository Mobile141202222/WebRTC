function IconBase({ children, className = 'button-icon', viewBox = '0 0 24 24' }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox={viewBox}
    >
      {children}
    </svg>
  );
}

export function SunIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.4M12 19.6V22M4.93 4.93l1.7 1.7M17.37 17.37l1.7 1.7M2 12h2.4M19.6 12H22M4.93 19.07l1.7-1.7M17.37 6.63l1.7-1.7" />
    </IconBase>
  );
}

export function MoonIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5Z" />
    </IconBase>
  );
}

export function PlusIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

export function ArrowRightIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </IconBase>
  );
}

export function CopyIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    </IconBase>
  );
}

export function CheckIcon(props) {
  return (
    <IconBase {...props}>
      <path d="m5 12 4.2 4.2L19 6.5" />
    </IconBase>
  );
}

export function MicIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 16a4 4 0 0 0 4-4V8a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4Z" />
      <path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22M8.5 22h7" />
    </IconBase>
  );
}

export function MicOffIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M8 8.3V8a4 4 0 1 1 8 0v4a4 4 0 0 1-.5 1.9" />
      <path d="M5 11.5a7 7 0 0 0 9.4 6.6M12 18.5V22M8.5 22h7" />
      <path d="m4 4 16 16" />
    </IconBase>
  );
}

export function VideoIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="6" width="13" height="12" rx="3" />
      <path d="m16 10 5-3.2v10.4L16 14" />
    </IconBase>
  );
}

export function VideoOffIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="6" width="13" height="12" rx="3" />
      <path d="m16 10 5-3.2v10.4L16 14" />
      <path d="m4 4 16 16" />
    </IconBase>
  );
}

export function SendIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M21 3 10 14" />
      <path d="m21 3-7 18-4-7-7-4 18-7Z" />
    </IconBase>
  );
}

export function ExitIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </IconBase>
  );
}

export function VoiceIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 13a8 8 0 0 1 16 0" />
      <path d="M6.5 13a5.5 5.5 0 0 1 11 0" />
      <circle cx="12" cy="13" r="1.2" fill="currentColor" stroke="none" />
    </IconBase>
  );
}
