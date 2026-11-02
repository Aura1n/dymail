const paths = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  compose:
    '<path d="M4 20h4.6L19.2 9.4a2.1 2.1 0 0 0 0-3L17.6 4.8a2.1 2.1 0 0 0-3 0L4 15.4V20Z"/><path d="m13.4 6.2 4.4 4.4"/>',
  edit: '<path d="M4 20h4l10.2-10.2a2.1 2.1 0 0 0 0-3l-.9-.9a2.1 2.1 0 0 0-3 0L4 16v4Z"/><path d="m12.8 7.2 4 4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"/>',
  inbox:
    '<path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5"/><path d="M4 13.5h4.6l1.5 2h3.8l1.5-2H20"/><path d="m4 13.5 2.1-7A2 2 0 0 1 8 5h8a2 2 0 0 1 1.9 1.5l2.1 7"/>',
  sent: '<path d="M21 3 10.2 13.8"/><path d="m21 3-6.4 18-4.4-7.2L3 9.4 21 3Z"/>',
  drafts:
    '<path d="M6 3h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M13 3v5h5"/><path d="M8.5 13h7M8.5 16.5H13"/>',
  junk:
    '<path d="M12 3 3.7 6.6v5.1c0 4.7 3.2 8.2 8.3 9.3 5.1-1.1 8.3-4.6 8.3-9.3V6.6L12 3Z"/><path d="M12 8v4.6M12 16h.01"/>',
  trash:
    '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-12"/><path d="M10 11v5M14 11v5"/>',
  archive:
    '<path d="M4 8.5h16V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5Z"/><path d="M3 4.5h18v4H3z"/><path d="M9.5 12.5h5"/>',
  reply: '<path d="m9 7-5 5 5 5"/><path d="M4 12h9.5a6.5 6.5 0 0 1 6.5 6.5V20"/>',
  replyAll:
    '<path d="m7 7-5 5 5 5"/><path d="m12 7-5 5 5 5"/><path d="M7 12h7.5a6.5 6.5 0 0 1 6.5 6.5V20"/>',
  forward: '<path d="m15 7 5 5-5 5"/><path d="M20 12h-9.5A6.5 6.5 0 0 0 4 18.5V20"/>',
  star: '<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.8Z"/>',
  'star-filled': '<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.8Z" fill="currentColor"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  checkAll: '<path d="m3 12.5 4 4L16 7.5"/><path d="m12.5 16.5 1.5 1.5L23 8.5"/>',
  selectAll:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="m8 12.3 2.9 2.9 5.4-5.7"/>',
  'unread-dot':
    '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v9a2.5 2.5 0 0 1-2.5 2.5h-7L6 21v-3h.5A2.5 2.5 0 0 1 4 15.5v-9Z"/><circle cx="16.5" cy="7.5" r="2.2" fill="currentColor" stroke="none"/>',
  paperclip:
    '<path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.3-8.3a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.8 1.8 0 0 1-2.5-2.5l7.6-7.6"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19.5h14"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.7"/>',
  'eye-off':
    '<path d="m3 3 18 18"/><path d="M10.6 6.2A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-3.3 4.1"/><path d="M6.6 6.9C4 8.7 2.5 12 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  bold: '<path d="M7 4h6a4 4 0 0 1 0 8H7V4Z"/><path d="M7 12h7a4 4 0 0 1 0 8H7v-8Z"/>',
  italic: '<path d="M10 4h8M6 20h8M15 4 9 20"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r=".8" fill="currentColor"/><circle cx="4.5" cy="12" r=".8" fill="currentColor"/><circle cx="4.5" cy="18" r=".8" fill="currentColor"/>',
  warning: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 9.5v4.5M12 17.5h.01"/>',
  contacts: '<circle cx="12" cy="8.2" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  translate:
    '<path d="M2.6 18.6 6.1 7.7h.9l3.5 10.9"/><path d="M3.9 14.8h5.3"/><path d="M13.4 10.4h7.2"/><path d="M17 7.6v2.8"/><path d="M14.6 13.3c1.4 2.9 3.3 4.7 5.7 5.6"/><path d="M20.3 13.3c-1.4 2.9-3.3 4.7-5.7 5.6"/>',
  'image-off':
    '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z"/><path d="m4 16 5-5 4 4 2-2 5 5"/><circle cx="15" cy="8.5" r="1.3"/><path d="m3 3 18 18"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>'
};

export function icon(name, className = '') {
  const content = paths[name] || '';
  return `<svg class="icon${className ? ` ${className}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
}
