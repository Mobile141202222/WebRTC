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

export function SettingsIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 8.8A3.2 3.2 0 1 1 8.8 12 3.2 3.2 0 0 1 12 8.8Z" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.2 1.2 0 0 1 0 1.7l-1 1a1.2 1.2 0 0 1-1.7 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1.2 1.2 0 0 1-1.2 1.2h-1.6A1.2 1.2 0 0 1 10.2 20v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1.2 1.2 0 0 1-1.7 0l-1-1a1.2 1.2 0 0 1 0-1.7l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4A1.2 1.2 0 0 1 2.8 13v-1.6A1.2 1.2 0 0 1 4 10.2h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1.2 1.2 0 0 1 0-1.7l1-1a1.2 1.2 0 0 1 1.7 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4A1.2 1.2 0 0 1 11.4 2.8H13A1.2 1.2 0 0 1 14.2 4v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.2 1.2 0 0 1 1.7 0l1 1a1.2 1.2 0 0 1 0 1.7l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2A1.2 1.2 0 0 1 21.2 11.4V13a1.2 1.2 0 0 1-1.2 1.2h-.2a1 1 0 0 0-.9.8Z" />
    </IconBase>
  );
}

export function ScreenShareIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2.5" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
      <path d="m12 8 4 4-4 4" />
      <path d="M8 12h8" />
    </IconBase>
  );
}

export function ScreenStopIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2.5" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
      <path d="m4 4 16 16" />
    </IconBase>
  );
}

export function PlayIcon(props) {
  return (
    <IconBase {...props}>
      <path d="m8 6 10 6-10 6Z" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function PauseIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M9 6v12M15 6v12" />
    </IconBase>
  );
}

export function TrashIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v5M14 11v5" />
      <path d="M6 7l1 12a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 7" />
      <path d="M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7" />
    </IconBase>
  );
}

export function LinkIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 1 0 12 20.1l1.2-1.1" />
    </IconBase>
  );
}

export function RefreshIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M20 11a8 8 0 0 0-14.4-4.6L3 9" />
      <path d="M3 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.4 4.6L21 15" />
      <path d="M16 15h5v5" />
    </IconBase>
  );
}

export function CloseIcon(props) {
  return (
    <IconBase {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </IconBase>
  );
}
