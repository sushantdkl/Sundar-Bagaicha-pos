'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Users, Package, FileText, Settings, DollarSign, ShoppingCart,
  LayoutDashboard, Warehouse, LayoutGrid, FolderOpen, Menu, X, Inbox, ChefHat, Wallet, Truck, Trash,
  Building2, ChevronDown, Ruler, Layers, TrendingUp, Activity,
  BookOpen, ScrollText, Coins, Landmark, CreditCard, ArrowRightLeft, Undo2, Receipt, Gauge, ClipboardCheck,
  BarChart3, Globe, ReceiptText, CalendarClock, BellRing, Calendar,
  PiggyBank, ShieldCheck, WalletCards, PartyPopper, CalendarRange
} from 'lucide-react';
import LogoutButton from '@/components/ui/logout-button';
import { isNavHidden } from '@/lib/deployment';

function readPanelAuthSync() {
  if (typeof window === 'undefined') return false;
  try {
    const token = localStorage.getItem('pos_token');
    const user = JSON.parse(localStorage.getItem('pos_user') || '{}');
    const cashierPanel = window.location.pathname.startsWith('/cashier');
    const roleAllowed = cashierPanel
      ? ['admin', 'cashier'].includes(user.role)
      : user.role === 'admin';
    // A non-admin on the Events subtree may hold events.view, but only the
    // server knows. Resolving that needs a request, so this returns false and
    // the spinner stays up until the capability check answers.
    return Boolean(token && roleAllowed);
  } catch {
    return false;
  }
}

function readNavGroupsSync() {
  if (typeof window === 'undefined') return {};
  try {
    const saved = JSON.parse(localStorage.getItem('admin_nav_groups') || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function readNavScrollSync() {
  if (typeof window === 'undefined') return 0;
  try {
    return Number(sessionStorage.getItem('admin_nav_scroll') || '0') || 0;
  } catch {
    return 0;
  }
}

export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const isCashierPanel = pathname === '/cashier' || pathname?.startsWith('/cashier/');
  // The Events subtree is the one part of /admin an admin can delegate: a
  // cashier granted events.view gets in, and only here. Every other admin page
  // stays admin-only exactly as before.
  const isEventsPanel = pathname === '/admin/events' || Boolean(pathname?.startsWith('/admin/events/'));
  // Always start loading=true so SSR HTML matches the client's first paint.
  // Reading localStorage in useState() made the client skip the spinner while
  // the server still rendered it Ã¢â€ â€™ hydration mismatch.
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [backdropReady, setBackdropReady] = useState(false);
  const [leadsBadge, setLeadsBadge] = useState(0);
  const [ordersBadge, setOrdersBadge] = useState(0);
  const [waiterCallsBadge, setWaiterCallsBadge] = useState(0);
  const [capabilities, setCapabilities] = useState(null);
  // The role the server reports, which arrives with the capability check.
  // Null until then, which reads as "not delegated" — so an admin sees the
  // full sidebar from the first paint and nothing flickers.
  const [userRole, setUserRole] = useState(null);
  const [openGroups, setOpenGroups] = useState({});
  const openLockRef = useRef(false);
  const navScrollRef = useRef(null);
  const navScrollRestoredRef = useRef(false);

  // Resolve auth + nav prefs before paint when possible (avoids spinner flash
  // without disagreeing with the server HTML).
  useLayoutEffect(() => {
    setOpenGroups(readNavGroupsSync());
    if (readPanelAuthSync()) setLoading(false);
  }, []);

  // Restore expanded groups once on mount (also covered above; keep for safety).
  useEffect(() => {
    const saved = readNavGroupsSync();
    if (Object.keys(saved).length) setOpenGroups(saved);
  }, []);

  const toggleGroup = (label) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        localStorage.setItem('admin_nav_groups', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const isPosRoute = pathname === '/admin/pos' || pathname?.startsWith('/admin/pos/')
    || pathname === '/cashier/pos' || pathname?.startsWith('/cashier/pos/');

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = (event) => {
      const desktop = event && typeof event.matches === 'boolean' ? event.matches : mq.matches;
      setIsDesktop(desktop);
      if (desktop) {
        const onPos = window.location.pathname.startsWith('/admin/pos')
          || window.location.pathname.startsWith('/cashier/pos');
        if (onPos) {
          setSidebarOpen(false);
        } else {
          const saved = localStorage.getItem('admin_sidebar_open');
          setSidebarOpen(saved !== null ? saved === 'true' : true);
        }
      } else {
        setSidebarOpen(false);
      }
    };
    apply();
    mq.addEventListener('change', apply);
    const token = localStorage.getItem('pos_token');
    const user = JSON.parse(localStorage.getItem('pos_user') || '{}');
    const roleAllowed = isCashierPanel
      ? ['admin', 'cashier'].includes(user.role)
      : user.role === 'admin';
    if (!token) router.push('/login');
    else if (roleAllowed) setLoading(false);
    // Not allowed by role, but on Events: wait for the capability check below
    // rather than bouncing someone who may have been granted access.
    else if (!isEventsPanel) router.push('/login');
    return () => mq.removeEventListener('change', apply);
  }, [router, isCashierPanel, isEventsPanel]);

  useEffect(() => {
    if (!isEventsPanel && (loading || !isCashierPanel)) return undefined;
    let cancelled = false;
    const token = localStorage.getItem('pos_token');
    if (!token) return undefined;
    fetch('/api/auth/capabilities', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled) return;
        setUserRole(data?.role || null);
        setCapabilities(data?.capabilities || {});
      })
      .catch(() => { if (!cancelled) setCapabilities({}); });
    return () => { cancelled = true; };
  }, [loading, isCashierPanel, isEventsPanel, pathname]);

  // A delegated non-admin is admitted by deriving the gate rather than
  // flipping `loading`, so the two decisions never race. Failing closed is
  // deliberate: a failed capability call sets {} and this effect sends them to
  // login. The API enforces the same permissions independently.
  const eventsDelegationAllows = isEventsPanel && capabilities?.['events.view'] === true;

  useEffect(() => {
    if (!loading || !isEventsPanel || capabilities === null) return;
    if (capabilities['events.view'] !== true) router.push('/login');
  }, [loading, isEventsPanel, capabilities, router]);

  // When entering POS, force-collapse (don't overwrite user's saved preference).
  // When leaving POS, restore the saved preference.
  useEffect(() => {
    if (!isDesktop) return;
    if (isPosRoute) {
      setSidebarOpen(false);
    } else {
      const saved = localStorage.getItem('admin_sidebar_open');
      setSidebarOpen(saved !== null ? saved === 'true' : true);
    }
  }, [isPosRoute, isDesktop]);

  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const fetchCounts = async () => {
      try {
        const token = localStorage.getItem('pos_token');
        if (!token) return;
        const user = JSON.parse(localStorage.getItem('pos_user') || '{}');
        // New website (online) orders Ã¢â‚¬â€ pending WEB-* orders.
        try {
          const oRes = await fetch('/api/admin/orders?status=pending&pageSize=100', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (oRes.ok) {
            const oData = await oRes.json();
            const n = (oData.orders || oData.data || []).filter((o) =>
              String(o.order_number || '').startsWith('WEB-')
            ).length;
            if (!cancelled) setOrdersBadge(n);
          }
        } catch { /* ignore */ }
        // Cashiers are not authorised for reservation/lead badges. Shared
        // navigation should not repeatedly call endpoints that must reject them.
        if (user.role !== 'admin') return;
        const res = await fetch('/api/admin/reservations/alerts', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) {
          // fallback counts
          const cRes = await fetch('/api/admin/leads/counts', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!cRes.ok || cancelled) return;
          const data = await cRes.json();
          const n = Number(data?.counts?.new_total || 0);
          const soon = Number(data?.counts?.arriving_soon || 0);
          setLeadsBadge(n + soon);
          return;
        }
        const data = await res.json();
        const alertN = (data.alerts || []).filter((a) =>
          ['arriving_soon', 'late', 'no_show_candidate', 'arrived', 'vip_arrived'].includes(a.type)
        ).length;
        const cRes = await fetch('/api/admin/leads/counts', {
          headers: { Authorization: `Bearer ${token}` },
        });
        let newTotal = 0;
        if (cRes.ok) {
          const c = await cRes.json();
          newTotal = Number(c?.counts?.new_total || 0);
        }
        if (!cancelled) setLeadsBadge(newTotal + alertN);
      } catch {
        /* ignore */
      }
    };
    fetchCounts();
    const t = setInterval(fetchCounts, 60000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [loading, pathname]);

  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const fetchWaiterCalls = async () => {
      try {
        const token = localStorage.getItem('pos_token');
        if (!token) return;
        const response = await fetch('/api/waiter-requests?status=active&limit=1', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setWaiterCallsBadge(Number(data?.counts?.active || 0));
      } catch { /* badge polling should never block navigation */ }
    };
    fetchWaiterCalls();
    const timer = setInterval(fetchWaiterCalls, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [loading, pathname]);

  // Delay backdrop so the opening tap does not immediately close the menu
  useEffect(() => {
    if (sidebarOpen && !isDesktop) {
      openLockRef.current = true;
      setBackdropReady(false);
      const t = setTimeout(() => {
        setBackdropReady(true);
        openLockRef.current = false;
      }, 180);
      return () => clearTimeout(t);
    }
    setBackdropReady(false);
    openLockRef.current = false;
  }, [sidebarOpen, isDesktop]);

  const openSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    if (openLockRef.current) return;
    setSidebarOpen(false);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      // Don't persist the POS forced-collapse preference over the user's choice.
      const onPos = typeof window !== 'undefined' && (
        window.location.pathname.startsWith('/admin/pos')
        || window.location.pathname.startsWith('/cashier/pos')
      );
      if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches && !onPos) {
        localStorage.setItem('admin_sidebar_open', String(next));
      }
      return next;
    });
  }, []);

  // Persist the sidebar scroll position across page remounts. Each admin page
  // wraps its own AdminLayout, so the nav unmounts on navigation Ã¢â‚¬â€ we restore
  // instantly via callback ref (before paint) so it never jumps to the top.
  const saveNavScroll = useCallback(() => {
    const top = navScrollRef.current?.scrollTop ?? 0;
    try {
      sessionStorage.setItem('admin_nav_scroll', String(top));
    } catch {
      /* ignore */
    }
  }, []);

  const attachNavScroll = useCallback((el) => {
    navScrollRef.current = el;
    if (!el || navScrollRestoredRef.current) return;
    const saved = readNavScrollSync();
    if (saved > 0) el.scrollTop = saved;
    navScrollRestoredRef.current = true;
  }, []);

  useLayoutEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;
    const saved = readNavScrollSync();
    if (saved > 0 && Math.abs(el.scrollTop - saved) > 1) el.scrollTop = saved;
  }, [pathname, sidebarOpen, isDesktop]);

  const navigate = (href) => {
    saveNavScroll();
    router.push(href, { scroll: false });
    if (!isDesktop) setSidebarOpen(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    router.push('/login');
  };

  // Grouped nav. Standalone entries (Dashboard, Settings) have no `items`.
  // Add new modules by dropping an entry into the relevant group Ã¢â‚¬â€ no layout rewrite.
  const adminNavGroups = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/admin/dashboard', color: 'text-gray-600' },
    { icon: Receipt, label: 'POS', href: '/admin/pos', color: 'text-emerald-700' },
    { icon: BarChart3, label: 'Analytics', href: '/admin/analytics', color: 'text-indigo-600' },
    { icon: ScrollText, label: 'Summary', href: '/admin/summary-report', color: 'text-rose-700' },
    {
      label: 'Operations',
      items: [
        { icon: BellRing, label: 'Waiter Calls', href: '/admin/waiter-requests', color: 'text-amber-700', badge: waiterCallsBadge },
        { icon: Inbox, label: 'Host desk', href: '/admin/leads', color: 'text-amber-600', badge: leadsBadge },
        { icon: Inbox, label: 'Online Orders', href: '/admin/orders/online', color: 'text-amber-600', badge: ordersBadge },
        { icon: ShoppingCart, label: 'Orders', href: '/admin/orders', color: 'text-orange-600' },
        { icon: ReceiptText, label: 'Bills', href: '/admin/bills', color: 'text-emerald-600' },
        { icon: ChefHat, label: 'KOT', href: '/admin/kot', color: 'text-amber-600' },
        { icon: LayoutGrid, label: 'Tables', href: '/admin/tables', color: 'text-cyan-600' },
        { icon: Layers, label: 'Table Management', href: '/admin/table-management', color: 'text-sky-600' },
        { icon: Activity, label: 'Kitchen Analytics', href: '/admin/kitchen-analytics', color: 'text-orange-600' },
      ],
    },
    {
      label: 'Events',
      items: [
        { icon: PartyPopper, label: 'Events Dashboard', href: '/admin/events', color: 'text-fuchsia-700', requiredPermission: 'events.view' },
        { icon: CalendarRange, label: 'Events Calendar', href: '/admin/events/calendar', color: 'text-violet-600', requiredPermission: 'events.view' },
        { icon: LayoutGrid, label: 'Event Spaces', href: '/admin/events/spaces', color: 'text-teal-700', requiredPermission: 'events.view' },
        { icon: Layers, label: 'Event Packages', href: '/admin/events/packages', color: 'text-amber-700', requiredPermission: 'events.view' },
        { icon: TrendingUp, label: 'Event Reports', href: '/admin/events/reports', color: 'text-emerald-700', requiredPermission: 'events.reports' },
      ],
    },
    {
      label: 'Menu',
      items: [
        { icon: Package, label: 'Menu', href: '/admin/products', color: 'text-blue-600' },
        { icon: FolderOpen, label: 'Categories', href: '/admin/categories', color: 'text-purple-600' },
        { icon: ChefHat, label: 'Recipes', href: '/admin/recipes', color: 'text-rose-600' },
      ],
    },
    {
      label: 'Inventory',
      items: [
        { icon: Gauge, label: 'Inventory Dashboard', href: '/admin/inventory/dashboard', color: 'text-indigo-700' },
        { icon: Warehouse, label: 'Inventory', href: '/admin/inventory', color: 'text-indigo-600' },
        { icon: FolderOpen, label: 'Inventory Categories', href: '/admin/inventory-categories', color: 'text-violet-600' },
        { icon: Ruler, label: 'Unit Conversion', href: '/admin/unit-conversion', color: 'text-sky-600' },
        { icon: Truck, label: 'Purchases', href: '/admin/purchases', color: 'text-teal-600' },
        { icon: Building2, label: 'Suppliers', href: '/admin/suppliers', color: 'text-slate-600' },
        { icon: Trash, label: 'Wastage', href: '/admin/wastage', color: 'text-red-600' },
      ],
    },
    {
      label: 'People',
      items: [
        { icon: Users, label: 'Employees', href: '/admin/employees', color: 'text-green-600' },
        { icon: WalletCards, label: 'Salary & Advances', href: '/admin/payroll', color: 'text-emerald-700' },
        { icon: TrendingUp, label: 'Employee Performance', href: '/admin/employee-performance', color: 'text-lime-600' },
        { icon: Users, label: 'Customers', href: '/admin/customers', color: 'text-pink-600' },
      ],
    },
    {
      label: 'Finance',
      items: [
        { icon: Wallet, label: 'Expenses', href: '/admin/expenses', color: 'text-emerald-600' },
        { icon: PiggyBank, label: 'Savings & Deposits', href: '/admin/savings', color: 'text-sky-700' },
        { icon: FolderOpen, label: 'Expense Categories', href: '/admin/expense-categories', color: 'text-emerald-700' },
        { icon: ArrowRightLeft, label: 'Cash Exchange', href: '/admin/cash-exchange', color: 'text-amber-600' },
        { icon: FileText, label: 'Reports', href: '/admin/reports', color: 'text-purple-600' },
      ],
    },
    {
      label: 'Accounting',
      items: [
        { icon: CalendarClock, label: 'Opening & Closing', href: '/admin/business-days', color: 'text-emerald-700' },
        { icon: Gauge, label: 'Finance Dashboard', href: '/admin/finance-dashboard', color: 'text-gray-900' },
        { icon: BookOpen, label: 'Chart of Accounts', href: '/admin/chart-of-accounts', color: 'text-indigo-600' },
        { icon: ScrollText, label: 'General Ledger', href: '/admin/general-ledger', color: 'text-slate-600' },
        { icon: Coins, label: 'Cash Book', href: '/admin/cash-book', color: 'text-yellow-600' },
        { icon: Landmark, label: 'Bank Book', href: '/admin/bank-book', color: 'text-blue-600' },
        { icon: ClipboardCheck, label: 'Bank Reconciliation', href: '/admin/bank-reconciliation', color: 'text-cyan-700' },
        { icon: Wallet, label: 'Cash Drawer', href: '/admin/cash-drawer', color: 'text-orange-600' },
        { icon: Landmark, label: 'Bank', href: '/admin/bank', color: 'text-teal-600' },
        { icon: CreditCard, label: 'Settlements', href: '/admin/settlements', color: 'text-rose-600' },
        { icon: Receipt, label: 'Customer Ledger', href: '/admin/accounts-receivable', color: 'text-teal-700' },
        { icon: Receipt, label: 'Supplier Ledger', href: '/admin/accounts-payable', color: 'text-orange-700' },
        { icon: FileText, label: 'Financial Reports', href: '/admin/financial-reports', color: 'text-indigo-700' },
        { icon: Undo2, label: 'Corrections', href: '/admin/corrections', color: 'text-amber-700' },
      ],
    },
    { icon: Globe, label: 'Website CMS', href: '/admin/cms', color: 'text-sky-600' },
    { icon: ShieldCheck, label: 'Staff Permissions', href: '/admin/permissions', color: 'text-red-600' },
    { icon: Settings, label: 'Settings', href: '/admin/settings', color: 'text-gray-600' },
  ];

  const cashierNavGroups = [
    { icon: Receipt, label: 'POS', href: '/cashier/pos', color: 'text-emerald-700' },
    { icon: LayoutDashboard, label: 'Order Desk', href: '/cashier', color: 'text-gray-700' },
    {
      label: 'Ledgers',
      items: [
        { icon: Receipt, label: 'Customer Ledger', href: '/cashier/accounts-receivable', color: 'text-teal-700' },
        { icon: Receipt, label: 'Supplier Ledger', href: '/cashier/accounts-payable', color: 'text-orange-700' },
      ],
    },
    {
      label: 'Operations',
      items: [
        { icon: BellRing, label: 'Waiter Calls', href: '/cashier/waiter-requests', color: 'text-amber-700', badge: waiterCallsBadge },
        { icon: Inbox, label: 'Online Orders', href: '/cashier/online-orders', color: 'text-amber-600', badge: ordersBadge },
        { icon: Calendar, label: 'Reservations', href: '/cashier/reservations', color: 'text-violet-600' },
        { icon: ReceiptText, label: 'Bills', href: '/cashier/bills', color: 'text-emerald-600' },
        { icon: ChefHat, label: 'KOT History', href: '/cashier/kots', color: 'text-orange-600' },
        { icon: CreditCard, label: 'Payments', href: '/cashier/payment-history', color: 'text-blue-600' },
      ],
    },
    {
      label: 'Records',
      items: [
        { icon: Users, label: 'Customers', href: '/cashier/customers', color: 'text-pink-600' },
        { icon: Warehouse, label: 'Inventory', href: '/cashier/inventory', color: 'text-indigo-600' },
        { icon: Truck, label: 'Purchases', href: '/cashier/purchases', color: 'text-teal-600', requiredPermission: 'purchases.view' },
        { icon: Building2, label: 'Suppliers', href: '/cashier/suppliers', color: 'text-slate-600', requiredPermission: 'suppliers.view' },
        { icon: Trash, label: 'Wastage', href: '/cashier/wastage', color: 'text-red-600' },
        { icon: WalletCards, label: 'Salary & Advances', href: '/cashier/payroll', color: 'text-emerald-700', requiredPermission: 'payroll.view' },
      ],
    },
    {
      label: 'Cash & Credit',
      items: [
        { icon: Wallet, label: 'Expenses', href: '/cashier/expenses', color: 'text-emerald-600' },
        { icon: ArrowRightLeft, label: 'Cash Exchange', href: '/cashier/cash-exchange', color: 'text-amber-600' },
        { icon: Wallet, label: 'Cash Drawer', href: '/cashier/cash-drawer', color: 'text-orange-600' },
        { icon: CalendarClock, label: 'Opening & Closing', href: '/cashier/business-days', color: 'text-gray-700' },
      ],
    },
  ];

  // A non-admin who was delegated the Events subtree gets the Events group and
  // nothing else — showing them the whole admin sidebar would be a list of
  // links that all bounce back to the login screen.
  const delegatedEvents = isEventsPanel && userRole != null && userRole !== 'admin';
  const rawNavGroups = isCashierPanel
    ? cashierNavGroups
    : delegatedEvents
      ? adminNavGroups.filter((g) => g.label === 'Events')
      : adminNavGroups;

  // Apply the deployment profile: hide disabled waiter/kitchen/table/reservation
  // entries and drop any group left empty. Routes still exist for historical data.
  const navGroups = rawNavGroups
    .map((group) => {
      if (!group.items) return isNavHidden(group.href) ? null : group;
      const items = group.items.filter((it) => {
        if (isNavHidden(it.href)) return false;
        if (!it.requiredPermission) return true;
        // Admins see everything; the matrix only ever grants, never revokes,
        // so an admin's navigation is unchanged.
        if (userRole === 'admin') return true;
        if (!isCashierPanel && !delegatedEvents) return true;
        return capabilities?.[it.requiredPermission] === true;
      });
      return items.length ? { ...group, items } : null;
    })
    .filter(Boolean);

  const allNavHrefs = useMemo(
    () =>
      navGroups
        .flatMap((g) => (g.items ? g.items.map((i) => i.href) : g.href ? [g.href] : []))
        .filter(Boolean),
    [navGroups]
  );

  /** Longest path match with segment boundary Ã¢â‚¬â€ avoids /admin/inventory lighting up on /admin/inventory-categories. */
  const activeHref = useMemo(() => {
    if (!pathname) return null;
    const matches = allNavHrefs.filter(
      (h) => pathname === h || pathname.startsWith(`${h}/`)
    );
    if (!matches.length) return null;
    return matches.sort((a, b) => b.length - a.length)[0];
  }, [pathname, allNavHrefs]);

  const isActiveHref = (href) => activeHref === href;
  // Flat list only used when the desktop rail is collapsed to icons.
  const flatItems = navGroups.flatMap((g) => (g.items ? g.items : [g]));

  if (loading && !eventsDelegationAllows) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const showLabels = sidebarOpen || !isDesktop;

  const renderNavButton = (item, topLevel) => {
    const isActive = isActiveHref(item.href);
    return (
      <button
        key={item.href}
        type="button"
        onClick={() => navigate(item.href)}
        className={`w-full flex items-center ${
          showLabels ? `space-x-3 ${topLevel ? 'px-4' : 'pl-8 pr-4'}` : 'justify-center px-2'
        } py-2.5 rounded-lg text-left relative ${
          isActive ? 'bg-gray-100 border-l-4 border-gray-800' : 'active:bg-gray-50 hover:bg-gray-50'
        }`}
      >
        <item.icon className={`${item.color} ${showLabels ? 'w-5 h-5' : 'w-6 h-6'} flex-shrink-0`} />
        {showLabels && (
          <span className={`font-medium flex-1 ${isActive ? 'text-gray-900' : 'text-gray-700'}`}>
            {item.label}
          </span>
        )}
        {item.badge > 0 && (
          <span
            className={`${showLabels ? '' : 'absolute top-1.5 right-1.5'} min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center`}
          >
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      {/* Fixed mobile top bar Ã¢â‚¬â€ always above the aside so the hamburger is easy to tap */}
      <div className="lg:hidden print:hidden fixed top-0 inset-x-0 z-[70] bg-white border-b border-gray-200 px-2 py-1.5 flex items-center justify-between pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => {
            if (sidebarOpen) closeMobileSidebar();
            else openSidebar();
          }}
          className="relative z-[71] h-12 w-12 flex items-center justify-center rounded-xl bg-gray-100 active:bg-gray-200 text-gray-800 touch-manipulation [-webkit-tap-highlight-color:transparent]"
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        >
          {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <h2 className="text-base font-bold text-gray-800 pointer-events-none">{isCashierPanel ? 'Cashier Station' : 'Admin Panel'}</h2>
        <div className="h-12 w-12" aria-hidden />
      </div>

      {backdropReady && sidebarOpen && !isDesktop && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-[55] bg-black/20 lg:hidden touch-manipulation"
          onClick={closeMobileSidebar}
        />
      )}

      <aside
        className={`print:hidden fixed top-0 left-0 h-full bg-white border-r border-gray-200 shadow-xl lg:shadow-none transition-transform duration-200 z-[60] flex flex-col ${
          sidebarOpen
            ? 'w-64 translate-x-0 pointer-events-auto'
            : 'w-64 -translate-x-full pointer-events-none lg:pointer-events-auto lg:w-20 lg:translate-x-0'
        }`}
      >
        <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 gap-2 pt-[max(1rem,env(safe-area-inset-top))] lg:pt-4">
          {showLabels && <h2 className="text-xl font-bold text-gray-800 truncate">{isCashierPanel ? 'Cashier Station' : 'Admin Panel'}</h2>}
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden lg:flex min-h-10 min-w-10 items-center justify-center hover:bg-gray-100 rounded-lg text-gray-700 flex-shrink-0"
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <button
            type="button"
            onClick={closeMobileSidebar}
            className="lg:hidden h-12 w-12 flex items-center justify-center rounded-xl bg-gray-100 active:bg-gray-200 text-gray-800 touch-manipulation"
            aria-label="Close menu"
          >
            <X size={22} />
          </button>
        </div>

        <nav
          ref={attachNavScroll}
          onScroll={saveNavScroll}
          className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-1"
        >
          {showLabels
            ? navGroups.map((group) => {
                if (!group.items) return renderNavButton(group, true);
                const hasActive = group.items.some((it) => isActiveHref(it.href));
                const expanded = openGroups[group.label] ?? hasActive;
                const groupBadge = group.items.reduce((n, it) => n + (it.badge || 0), 0);
                return (
                  <div key={group.label}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.label)}
                      className="w-full flex items-center gap-2 px-4 py-2 rounded-lg text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-50"
                    >
                      <span className="flex-1">{group.label}</span>
                      {!expanded && groupBadge > 0 && (
                        <span className="min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {groupBadge > 99 ? '99+' : groupBadge}
                        </span>
                      )}
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {expanded && (
                      <div className="mt-1 space-y-1">
                        {group.items.map((item) => renderNavButton(item, false))}
                      </div>
                    )}
                  </div>
                );
              })
            : flatItems.map((item) => renderNavButton(item, true))}
        </nav>

        <div className="flex-shrink-0 p-3 border-t border-gray-200">
          <LogoutButton
            onLogout={handleLogout}
            variant="sidebar"
            iconOnly={!showLabels}
            label="Logout"
            className={!showLabels ? 'justify-center px-2 space-x-0' : ''}
          />
        </div>
      </aside>

      <div
        className={`min-h-screen min-w-0 pt-14 lg:pt-0 print:!ml-0 print:!pt-0 ${
          sidebarOpen ? 'lg:ml-64' : 'lg:ml-20'
        } ${sidebarOpen && !isDesktop ? 'opacity-45' : 'opacity-100'}`}
      >
        <div className="admin-page-content w-full min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
