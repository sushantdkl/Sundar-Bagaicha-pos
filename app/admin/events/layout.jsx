import './events-theme.css';

/**
 * Events module shell — the stylesheet, and deliberately no markup.
 *
 * `display: contents` means this wrapper contributes nothing to layout: the
 * pages still render straight into AdminLayout's content area, and typography
 * keeps falling through from the root layout's font so the Events screens read
 * as the same product as the rest of the admin.
 *
 * Nothing here applies the theme. A page opts in by rendering
 * `<div className="evx">`, so the Events screens the redesign does not cover
 * (Calendar, Spaces, Packages, Reports, BEO) are untouched.
 */
export default function EventsLayout({ children }) {
  return <div style={{ display: 'contents' }}>{children}</div>;
}
