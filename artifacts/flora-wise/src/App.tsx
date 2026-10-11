import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams } from "wouter";
import { ClerkProvider, SignIn, useClerk, useAuth, useSignUp, useUser } from "@clerk/react";
import { ukUA } from "@clerk/localizations";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import {
  Activity, ArrowRight, BarChart3, Bell, BookOpen, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Droplets, FileText,
  Flower2, Gauge, Leaf, Lightbulb, ListFilter, Menu, MoreHorizontal, Pencil,
  Plus, RefreshCw, Search, ShieldCheck, Sprout, Sun, Trash2, TrendingUp,
  Wind, X, Zap,
} from "lucide-react";
import {
  getGetCurrentUserQueryKey, getGetDashboardQueryKey, getGetPlantQueryKey,
  getListPlantsQueryKey, getListRecommendationsQueryKey, getListRemindersQueryKey, getListReportsQueryKey,
  getListSpeciesQueryKey, getListTasksQueryKey, getListCareHistoryQueryKey, getGetStatisticsQueryKey, useApplyRecommendation, useCompleteTask, useCreatePlant,
  useCreateReport, useCreateSpecies, useCreateTask, useDeleteSpecies, useDeleteTask, useGetCurrentUser,
  useDeletePlant, useGetDashboard, useGetPlant, useGetStatistics, useGenerateRecommendation, useListCareHistory,
  useListPlants, useListRecommendations, useListReminders, useListReports, useListSpecies, useListTasks,
  useUpdateCurrentUser, useUpdatePlant, useUpdateReminder, useUpdateSpecies, useUpdateTask,
} from "@workspace/api-client-react";
import type { CareHistory, CareTask, Plant, PlantSpecies, Recommendation, RecommendationResult, Report, Statistics, User } from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";
import { PlantForm } from "@/components/plant-form";
import { PlantPhoto } from "@/components/plant-photo";
import { roundWeatherTemperature, shortWeatherLocationName } from "@/lib/weather-display";
import { CarePlanDialog } from "@/components/care-plan-dialog";
import { SavedLocationsPanel } from "@/components/saved-locations-panel";
import { SpeciesDetails } from "@/components/species-knowledge";
import { SpeciesEditor } from "@/components/species-editor";
import { envLabel, careTypeLabel, CategoryFilter, errMsg } from "@/components/fw-ui";
import { TaskCreateForm } from "@/components/task-create-form";
import { CARE_TYPES, CATEGORY_LABELS, type CareType, type PlantCategory, isCategory } from "@workspace/plant-care";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL ?? "";
const previewSignedOutKey = "florawise-preview-signed-out";
const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
const isPreviewSignedOut = () => window.localStorage.getItem(previewSignedOutKey) === "true";
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#38644a",
    colorForeground: "#2d3a31",
    colorMutedForeground: "#6d786f",
    colorDanger: "#b34a45",
    colorBackground: "#fffdf8",
    colorInput: "#fffdf8",
    colorInputForeground: "#2d3a31",
    colorNeutral: "#ddd6c8",
    fontFamily: "DM Sans, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#fffdf8] rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-serif text-[#2d3a31]",
    headerSubtitle: "text-[#6d786f]",
    socialButtonsBlockButtonText: "text-[#2d3a31]",
    formFieldLabel: "text-[#2d3a31]",
    footerActionLink: "text-[#38644a]",
    footerActionText: "text-[#6d786f]",
    dividerText: "text-[#6d786f]",
    identityPreviewEditButton: "text-[#38644a]",
    formFieldSuccessText: "text-[#38644a]",
    alertText: "text-[#b34a45]",
    logoBox: "rounded-xl overflow-hidden",
    logoImage: "rounded-xl",
    socialButtonsBlockButton: "border-[#ddd6c8] bg-[#fffdf8]",
    formButtonPrimary: "bg-[#38644a] hover:bg-[#2f563f] text-card",
    formFieldInput: "border-[#ddd6c8] bg-[#fffdf8] text-[#2d3a31]",
    footerAction: "bg-transparent",
    dividerLine: "bg-[#ddd6c8]",
    alert: "border-[#e8b6ae] bg-[#fff4f1]",
    otpCodeFieldInput: "border-[#ddd6c8] bg-[#fffdf8]",
    formFieldRow: "gap-2",
    main: "bg-transparent",
  },
};
const fmt = (date?: string | null) => date ? new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(date)) : "—";
const fmtLong = (date?: string | null) => date ? new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(new Date(date)) : "—";
const fmtDayMonth = (date?: string | null) => date ? new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date.slice(0, 10)}T00:00:00.000Z`)) : "—";
const todayLabel = new Intl.DateTimeFormat("uk-UA", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
const taskLabel: Record<string, string> = { ...careTypeLabel, ...Object.fromEntries(Object.entries(careTypeLabel).map(([key, value]) => [key.toLowerCase(), value])) };
const statusLabel: Record<string, string> = { planned: "Заплановано", PENDING: "Очікує", COMPLETED: "Виконано", completed: "Виконано", POSTPONED: "Перенесено", CANCELLED: "Скасовано" };
const priorityLabel: Record<string, string> = { high: "Високий", HIGH: "Високий", medium: "Середній", MEDIUM: "Середній", low: "Низький", LOW: "Низький" };
const passwordPolicyMessage = "Пароль має містити щонайменше 8 символів, одну велику літеру, одну малу літеру, цифру та спеціальний символ.";
const authLocalization = {
  ...ukUA,
  developmentMode: "Режим розробки",
  socialButtonsBlockButton: "Продовжити з {{provider|titleize}}",
  lastAuthenticationStrategy: "Використовувалось востаннє",
  dividerText: "або",
  formButtonPrimary: "Продовжити",
  formButtonPrimary__verify: "Підтвердити",
  formFieldLabel__emailAddress: "Електронна пошта",
  formFieldInputPlaceholder__emailAddress: "Введіть електронну пошту",
  formFieldInputPlaceholder__emailAddress_username: "Введіть електронну пошту або ім’я користувача",
  formFieldInputPlaceholder__password: "Введіть пароль",
  formFieldInputPlaceholder__signUpPassword: "Введіть пароль",
  formFieldLabel__password: "Пароль",
  formFieldError__notMatchingPasswords: "Паролі не збігаються.",
  formFieldError__verificationLinkExpired: "Термін дії посилання минув. Запросіть нове посилання.",
  signIn: {
    ...ukUA.signIn,
    start: {
      ...ukUA.signIn?.start,
      title: "З поверненням",
      subtitle: "Увійдіть, щоб продовжити турботу про рослини",
      actionText: "Не маєте облікового запису?",
      actionLink: "Зареєструватися",
    },
    accountSwitcher: {
      ...ukUA.signIn?.accountSwitcher,
      title: "Оберіть обліковий запис",
      subtitle: "Оберіть обліковий запис, з яким бажаєте продовжити.",
      action__addAccount: "Додати обліковий запис",
      action__signOutAll: "Вийти з усіх облікових записів",
    },
    alternativeMethods: {
      ...ukUA.signIn?.alternativeMethods,
      actionText: "Немає доступу до цих способів?",
      subtitle: "Якщо виникли труднощі, оберіть інший спосіб входу.",
    },
    forgotPassword: {
      ...ukUA.signIn?.forgotPassword,
      title: "Скинути пароль",
      subtitle: "Щоб скинути пароль",
      subtitle_email: "Введіть код, надісланий на вашу електронну пошту.",
      subtitle_phone: "Введіть код, надісланий на ваш телефон.",
    },
    resetPassword: {
      ...ukUA.signIn?.resetPassword,
      requiredMessage: "Для безпеки необхідно змінити пароль.",
    },
  },
  signUp: {
    ...ukUA.signUp,
    start: { ...ukUA.signUp?.start, title: "Створіть свій простір", subtitle: "Почніть із першої рослини" },
  },
  unstable__errors: {
    ...ukUA.unstable__errors,
    form_password_length_too_short: passwordPolicyMessage,
    form_param_format_invalid__email_address: "Введіть коректну електронну пошту.",
    form_code_incorrect: "Неправильний код підтвердження. Спробуйте ще раз.",
    form_password_incorrect: "Неправильний пароль. Спробуйте ще раз.",
    form_password_pwned__sign_in: "Цей пароль небезпечний. Змініть його, щоб продовжити.",
    captcha_invalid: "Не вдалося пройти перевірку безпеки. Оновіть сторінку та спробуйте ще раз.",
    captcha_unavailable: "Перевірка безпеки недоступна. Оновіть сторінку та спробуйте ще раз.",
  },
};
function signUpErrorText(cause: unknown, fallback: string) {
  const code = cause && typeof cause === "object" && "errors" in cause
    ? (cause.errors as Array<{ code?: string }>)[0]?.code
    : undefined;
  const messages: Record<string, string> = {
    form_identifier_exists: "Обліковий запис із такою електронною поштою вже існує.",
    form_identifier_exists__email_address: "Обліковий запис із такою електронною поштою вже існує.",
    form_param_format_invalid__email_address: "Введіть коректну електронну пошту.",
    form_password_length_too_short: passwordPolicyMessage,
    form_password_pwned: "Цей пароль небезпечний. Оберіть інший.",
    form_code_incorrect: "Неправильний код підтвердження. Спробуйте ще раз.",
    verification_expired: "Термін дії коду минув. Запросіть новий код.",
  };
  return code ? messages[code] ?? fallback : fallback;
}
const passwordPolicy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
const environmentLabels: Record<string, string> = { INDOOR: "У приміщенні", BALCONY: "Балкон", OUTDOOR: "Надворі", GREENHOUSE: "Теплиця" };
const readBrowserLocation = (onSuccess: (latitude: number, longitude: number) => void, onError: (message: string) => void) => {
  if (!navigator.geolocation) {
    onError("Браузер не підтримує визначення місцезнаходження.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => onSuccess(coords.latitude, coords.longitude),
    () => onError("Не вдалося визначити місцезнаходження. Перевірте дозвіл браузера або введіть координати вручну."),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
  );
};
const greetingFor = (name: string) => {
  const hour = new Date().getHours();
  if (hour < 12) return `Доброго ранку, ${name}`;
  if (hour < 18) return `Добрий день, ${name}`;
  return `Добрий вечір, ${name}`;
};

function Button({ children, onClick, variant = "primary", className = "", disabled, type = "button", testId }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "soft" | "ghost" | "danger"; className?: string; disabled?: boolean; type?: "button" | "submit"; testId?: string }) {
  const styles = { primary: "bg-primary text-primary-foreground hover:opacity-90", soft: "bg-secondary text-secondary-foreground hover:bg-accent", ghost: "text-muted-foreground hover:bg-muted hover:text-foreground", danger: "text-destructive hover:bg-destructive/10" };
  return <button data-testid={testId} type={type} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}>{children}</button>;
}
function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} data-testid={`button-${label}`} onClick={onClick} className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground ${className}`}>{children}</button>;
}
function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "danger" | "sun" }) {
  const tones = { neutral: "bg-muted text-muted-foreground", good: "bg-primary/10 text-primary", warn: "bg-accent/25 text-foreground", danger: "bg-destructive/10 text-destructive", sun: "bg-chart-2/20 text-foreground" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-card-border bg-card shadow-[0_10px_30px_hsl(154_25%_18%_/.04)] ${className}`}>{children}</section>;
}
function Skeleton({ className = "" }: { className?: string }) { return <div className={`fw-skeleton rounded-lg ${className}`} />; }
function QueryState({ loading, error, onRetry, children }: { loading?: boolean; error?: boolean; onRetry?: () => void; children: ReactNode }) {
  if (loading) return <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-48 md:col-span-2" /></div>;
  if (error) return <Panel className="p-8 text-center"><CircleAlert className="mx-auto mb-3 text-destructive" /><h3 className="font-serif text-xl">Не вдалося завантажити дані</h3><p className="mt-1 text-sm text-muted-foreground">Перевірте з’єднання й спробуйте ще раз.</p><Button variant="soft" onClick={onRetry} className="mt-5"><RefreshCw size={16} /> Повторити</Button></Panel>;
  return <>{children}</>;
}

const nav = [
  { href: "/dashboard", label: "Огляд", icon: Gauge },
  { href: "/plants", label: "Мої рослини", icon: Sprout },
  { href: "/calendar", label: "Календар догляду", icon: CalendarDays },
  { href: "/history", label: "Історія", icon: Activity },
  { href: "/recommendations", label: "Поради", icon: Lightbulb },
  { href: "/directory", label: "Довідник", icon: BookOpen },
  { href: "/statistics", label: "Статистика", icon: BarChart3 },
  { href: "/reports", label: "Звіти", icon: FileText },
];

function Logo({ light = false }: { light?: boolean }) {
  return <Link href="/" data-testid="link-logo" className={`flex items-center gap-2.5 ${light ? "text-sidebar-foreground" : "text-foreground"}`}><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-foreground"><Leaf size={20} strokeWidth={2.5} /></span><span className="font-serif text-xl font-semibold tracking-tight">FloraWise</span></Link>;
}
function useFloraIdentity() {
  const { user } = useUser();
  const currentUser = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  return useMemo(() => {
    const displayName = user?.firstName || user?.username || currentUser.data?.username || "Користувач FloraWise";
    return {
      displayName,
      displayEmail: user?.primaryEmailAddress?.emailAddress || currentUser.data?.email || "Електронну пошту не вказано",
      userId: user?.id || currentUser.data?.id || null,
    };
  }, [user?.firstName, user?.username, user?.primaryEmailAddress?.emailAddress, user?.id, currentUser.data?.username, currentUser.data?.email, currentUser.data?.id]);
}
function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const { signOut } = useClerk();
  const { displayName, displayEmail } = useFloraIdentity();
  const active = (href: string) => location === href || (href !== "/dashboard" && location.startsWith(href));
  const initials = displayName.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
  const handleSignOut = async () => {
    window.localStorage.setItem(previewSignedOutKey, "true");
    try {
      await signOut();
    } finally {
      window.location.assign(`${basePath || ""}/`);
    }
  };
  return <div className="fw-noise min-h-[100dvh] bg-background">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground shadow-xl transition-transform md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="mb-8 flex items-center justify-between px-2"><Logo light /><IconButton label="закрити меню" onClick={() => setOpen(false)} className="text-sidebar-foreground md:hidden"><X size={18} /></IconButton></div>
      <nav className="space-y-1" aria-label="Головна навігація">{nav.map(({ href, label, icon: I }) => <Link key={href} href={href} data-testid={`link-nav-${href.slice(1)}`} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${active(href) ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}><I size={18} />{label}</Link>)}</nav>
       <div className="mt-auto space-y-1 border-t border-sidebar-border pt-4">
          <Link href="/profile" data-testid="link-sidebar-profile" onClick={() => setOpen(false)} className="mt-4 flex items-center gap-3 rounded-xl bg-sidebar-accent p-3 hover:bg-sidebar-primary/30"><span className="grid h-8 w-8 place-items-center rounded-full bg-accent font-mono text-xs text-accent-foreground">{initials}</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{displayName}</p><p className="truncate text-xs text-sidebar-foreground/60">{displayEmail}</p></div><MoreHorizontal size={16} className="ml-auto text-sidebar-foreground/50" /></Link>
          <button type="button" onClick={handleSignOut} className="w-full rounded-xl px-3 py-2 text-left text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground">Вийти з простору</button>
      </div>
    </aside>
    {open && <button aria-label="закрити меню" data-testid="button-close-overlay" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-foreground/20 md:hidden" />}
    <main className="min-h-[100dvh] md:pl-[248px]"><header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur md:px-10"><div className="flex items-center gap-3"><IconButton label="відкрити меню" onClick={() => setOpen(true)} className="md:hidden"><Menu size={20} /></IconButton><div className="hidden md:block"><p className="font-mono text-[10px] uppercase tracking-[.22em] text-muted-foreground">Особистий простір</p><p className="font-serif text-lg leading-none">Турбота без шуму</p></div></div><div className="relative flex items-center gap-2"><Link href="/dashboard" data-testid="link-header-home" className="hidden rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted sm:block">Сьогодні</Link><IconButton label="сповіщення" onClick={() => {}}><Bell size={19} /></IconButton><button type="button" aria-label="відкрити профіль" data-testid="button-header-profile" onClick={() => setProfileMenuOpen(value => !value)} className="grid h-9 w-9 place-items-center rounded-full border border-accent bg-accent/30 font-mono text-xs font-bold text-foreground hover:ring-4 hover:ring-accent/30">{initials}</button>{profileMenuOpen && <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-border bg-card p-2 shadow-xl"><div className="border-b border-border px-3 py-3"><p className="truncate text-sm font-semibold">{displayName}</p><p className="truncate text-xs text-muted-foreground">{displayEmail}</p></div><Link href="/profile" data-testid="link-header-profile-page" onClick={() => setProfileMenuOpen(false)} className="mt-1 block rounded-xl px-3 py-2.5 text-sm hover:bg-muted">Мій профіль</Link><button type="button" data-testid="button-header-signout" onClick={handleSignOut} className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10">Вийти з простору</button></div>}</div></header><div className="mx-auto max-w-[1400px] px-5 py-8 md:px-10 md:py-10">{children}</div></main>
  </div>;
}
function PageHead({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mb-2 font-mono text-[10px] uppercase tracking-[.22em] text-primary">{eyebrow || "FloraWise"}</p><h1 className="font-serif text-4xl leading-none tracking-tight text-foreground md:text-5xl">{title}</h1>{description && <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>{action}</div>;
}
function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <Panel className="p-12 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary"><Sprout size={27} /></span><h3 className="mt-5 font-serif text-2xl">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>{action && <div className="mt-6">{action}</div>}</Panel>;
}
function TaskRow({ task, onComplete, onDelete, onPostpone }: { task: CareTask; onComplete: () => void; onDelete?: () => void; onPostpone?: () => void }) {
  const overdue = task.isOverdue || task.status === "OVERDUE";
  return <div className="group flex items-center gap-3 border-b border-border/70 py-4 last:border-0"><button aria-label={`виконати ${task.plantName}`} data-testid={`button-complete-task-${task.id}`} onClick={onComplete} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-border text-transparent hover:border-primary hover:bg-primary hover:text-primary-foreground"><Check size={15} /></button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className={`text-sm font-semibold ${task.status === "COMPLETED" ? "text-muted-foreground line-through" : ""}`}>{taskLabel[task.type] || task.type}</p>{overdue && <Badge tone="danger">Прострочено</Badge>}{task.priority && task.priority !== "low" && <Badge tone={task.priority.toLowerCase() === "high" ? "warn" : "neutral"}>{priorityLabel[task.priority] || task.priority}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{task.plantName} · {fmt(task.scheduledDate)}</p></div>{onPostpone && <IconButton label="перенести завдання" onClick={onPostpone} className="opacity-0 group-hover:opacity-100"><ChevronRight size={15} /></IconButton>}{onDelete && <IconButton label="видалити завдання" onClick={onDelete} className="opacity-0 group-hover:opacity-100"><Trash2 size={15} /></IconButton>}</div>;
}

function Landing() {
  const { data: user, isLoading } = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  if (!isPreviewSignedOut() && !isLoading && user) return <Redirect to="/dashboard" />;
  return <div className="fw-noise min-h-[100dvh] overflow-hidden bg-background"><header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 md:px-10"><Logo /><div className="flex items-center gap-2"><Link href="/sign-in" data-testid="link-landing-signin" className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted">Увійти</Link><Link href="/sign-up" data-testid="link-landing-signup" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Створити простір</Link></div></header><section className="relative mx-auto max-w-7xl px-5 pb-20 pt-14 md:px-10 md:pb-28 md:pt-24"><div className="pointer-events-none absolute -right-24 top-4 h-[500px] w-[500px] rounded-full bg-accent/25 blur-3xl" /><div className="relative grid items-center gap-16 lg:grid-cols-[1.05fr_.95fr]"><div className="fw-rise"><p className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.18em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Догляд, який підлаштовується</p><h1 className="max-w-3xl font-serif text-6xl leading-[.96] tracking-[-.04em] md:text-8xl">Рослини знають,<br /><em className="text-primary">коли їм краще.</em></h1><p className="mt-8 max-w-lg text-lg leading-8 text-muted-foreground">FloraWise поєднує ваші рослини, погоду та ритм дому, щоб підказати потрібну дію — саме тоді, коли вона має сенс.</p><div className="mt-9 flex flex-wrap gap-3"><Link href="/sign-up" data-testid="link-hero-start" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3.5 font-semibold text-primary-foreground hover:opacity-90">Почати турботу <ArrowRight size={17} /></Link><Link href="/directory" data-testid="link-hero-directory" className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3.5 font-semibold hover:bg-muted">Переглянути довідник</Link></div></div><div className="relative fw-rise fw-delay-2"><div className="absolute -left-8 top-10 h-32 w-32 rounded-full border border-primary/20" /><div className="absolute -right-2 bottom-2 h-20 w-20 rounded-full border border-accent bg-accent/20" /><div className="relative overflow-hidden rounded-[2.5rem] border border-primary/20 bg-[#d9e0ce] p-5 shadow-2xl shadow-primary/10"><div className="flex items-center justify-between rounded-2xl bg-[#f1eadb]/70 px-4 py-3"><span className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Мій ранок</span><span className="text-xs text-primary">12 березня</span></div><div className="relative mt-4 flex h-[370px] items-end justify-center overflow-hidden rounded-[1.75rem] bg-[#b9c6ae]"><div className="absolute bottom-0 h-36 w-60 rounded-[50%] bg-[#8b6a4d]" /><div className="absolute bottom-28 left-[36%] h-64 w-4 rotate-[-9deg] rounded-full bg-[#38644a]" /><div className="absolute bottom-44 left-[20%] h-28 w-20 rotate-[-31deg] rounded-[100%_0_100%_0] bg-[#4f805d]" /><div className="absolute bottom-52 right-[24%] h-36 w-24 rotate-[36deg] rounded-[100%_0_100%_0] bg-[#38644a]" /><div className="absolute bottom-72 left-[47%] h-20 w-14 rotate-[12deg] rounded-[100%_0_100%_0] bg-[#70966c]" /><div className="absolute bottom-4 left-4 rounded-xl bg-card/90 px-3 py-2 text-xs font-semibold shadow-lg"><Droplets className="mr-1 inline text-primary" size={14} /> Поливати через 2 дні</div></div></div></div></div></section><section className="border-y border-border bg-card/55"><div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:grid-cols-3 md:px-10"><div><p className="font-serif text-2xl">Погода поруч</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Враховуємо вологість, температуру й дощ, а не лише календар.</p></div><div><p className="font-serif text-2xl">Ваші правила</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Рекомендації пояснюють «чому», щоб рішення залишалося за вами.</p></div><div><p className="font-serif text-2xl">Живий ритм</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Історія догляду допомагає помічати зміни, а не рахувати нагадування.</p></div></div></section><footer className="mx-auto max-w-7xl px-5 py-10 md:px-10"><Logo /><p className="mt-4 text-sm text-muted-foreground">Тихий простір для уважного догляду.</p></footer></div>;
}

function SignInPage() {
  return <div className="fw-noise flex min-h-[100dvh] items-center justify-center bg-[#d9e0ce] px-4 py-8"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  const [, setLocation] = useLocation();
  const { fetchStatus, signUp } = useSignUp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const finishSignUp = async () => {
    const result = await signUp.finalize();
    if (result.error) throw result.error;
    setLocation("/dashboard");
  };

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setError("");
    if (!passwordPolicy.test(password)) {
      setError(passwordPolicyMessage);
      return;
    }
    if (password !== confirmation) {
      setError("Паролі не збігаються.");
      return;
    }
    setPending(true);
    try {
      const result = await signUp.password({ emailAddress: email.trim(), password });
      if (result.error) throw result.error;
      if (signUp.status === "complete") {
        await finishSignUp();
      } else {
        const verification = await signUp.verifications.sendEmailCode();
        if (verification.error) throw verification.error;
        setNeedsVerification(true);
      }
    } catch (cause) {
      setError(signUpErrorText(cause, "Не вдалося створити обліковий запис. Перевірте дані й спробуйте ще раз."));
    } finally {
      setPending(false);
    }
  };

  const verify = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!verificationCode.trim()) return;
    setPending(true);
    setError("");
    try {
      const verification = await signUp.verifications.verifyEmailCode({ code: verificationCode.trim() });
      if (verification.error) throw verification.error;
      await finishSignUp();
    } catch (cause) {
      setError(signUpErrorText(cause, "Код підтвердження неправильний або застарів."));
    } finally {
      setPending(false);
    }
  };

  const checks = [
    { label: "Щонайменше 8 символів", valid: password.length >= 8 },
    { label: "Одна велика літера", valid: /[A-Z]/.test(password) },
    { label: "Одна мала літера", valid: /[a-z]/.test(password) },
    { label: "Одна цифра", valid: /\d/.test(password) },
    { label: "Один спеціальний символ", valid: /[^A-Za-z\d]/.test(password) },
  ];

  if (fetchStatus === "fetching") return <div className="fw-noise grid min-h-[100dvh] place-items-center bg-[#d9e0ce]"><Skeleton className="h-10 w-40" /></div>;
  return <div className="fw-noise flex min-h-[100dvh] items-center justify-center bg-[#d9e0ce] px-4 py-8"><div className="w-[440px] max-w-full rounded-2xl bg-[#fffdf8] p-7 shadow-xl shadow-primary/10"><Logo /><h1 className="mt-8 font-serif text-3xl text-foreground">{needsVerification ? "Підтвердіть електронну пошту" : "Створіть свій простір"}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{needsVerification ? `Ми надіслали код на ${email}.` : "Почніть із першої рослини та налаштуйте свій ритм догляду."}</p>{error && <p role="alert" data-testid="text-signup-error" className="mt-5 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm leading-5 text-destructive">{error}</p>}{needsVerification ? <form onSubmit={verify} className="mt-6 grid gap-4"><label className="text-sm font-semibold">Код підтвердження<input data-testid="input-signup-verification-code" required inputMode="numeric" value={verificationCode} onChange={event => setVerificationCode(event.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 font-normal outline-none focus:ring-4 focus:ring-primary/10" /></label><Button type="submit" disabled={pending}>{pending ? "Перевіряємо…" : "Підтвердити пошту"}</Button></form> : <form onSubmit={submit} className="mt-6 grid gap-4"><label className="text-sm font-semibold">Електронна пошта<input data-testid="input-signup-email" required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 font-normal outline-none focus:ring-4 focus:ring-primary/10" /></label><label className="text-sm font-semibold">Пароль<input data-testid="input-signup-password" required type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 font-normal outline-none focus:ring-4 focus:ring-primary/10" /></label><div data-testid="text-password-policy" data-password-pattern={passwordPolicy.source} className="rounded-xl border border-primary/15 bg-secondary/50 px-4 py-3 text-xs leading-5 text-muted-foreground"><p>{passwordPolicyMessage}</p><ul className="mt-2 grid gap-1">{checks.map(check => <li key={check.label} className={check.valid ? "text-primary" : "text-muted-foreground"}>{check.valid ? "✓" : "○"} {check.label}</li>)}</ul></div><label className="text-sm font-semibold">Підтвердьте пароль<input data-testid="input-signup-confirm-password" required type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 font-normal outline-none focus:ring-4 focus:ring-primary/10" /></label><Button type="submit" disabled={pending}>{pending ? "Створюємо…" : "Створити обліковий запис"}</Button></form>}<p className="mt-6 text-center text-sm text-muted-foreground">Вже маєте обліковий запис? <Link href="/sign-in" className="font-semibold text-primary hover:underline">Увійти</Link></p></div></div>;
}

function PreviewProfile({ profile }: { profile: User }) {
  const initials = profile.username.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
  return <><PageHead eyebrow="Ваш простір" title="Профіль" description="Переглядайте й налаштовуйте дані демонстраційного простору FloraWise." /><div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]"><Panel className="p-6"><div className="flex items-center gap-4"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/40 font-mono text-lg font-bold text-foreground">{initials}</span><div><h2 className="font-serif text-2xl">{profile.username}</h2><p className="mt-1 text-sm text-muted-foreground">{profile.email}</p></div></div><div className="mt-7 rounded-xl bg-muted p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Роль у FloraWise</p><p className="mt-1 text-sm">{profile.role === "ADMIN" ? "Адміністратор" : "Користувач"}</p></div></Panel><Panel className="p-6"><h2 className="font-serif text-2xl">Дані профілю</h2><p className="mt-3 rounded-xl bg-accent/20 px-4 py-3 text-sm leading-6 text-muted-foreground">Це демонстраційний профіль preview. Ім’я та пошту керує демонстраційний режим.</p><div className="mt-5 grid gap-4"><label className="text-sm font-semibold">Ім’я<input value={profile.username} readOnly className="mt-2 w-full rounded-xl border border-input bg-muted px-4 py-3 font-normal text-muted-foreground" /></label><label className="text-sm font-semibold">Електронна пошта<input value={profile.email} readOnly className="mt-2 w-full rounded-xl border border-input bg-muted px-4 py-3 font-normal text-muted-foreground" /></label></div></Panel></div><div className="mt-5"><SavedLocationsPanel /></div></>;
}

function ProfilePage() {
  const { user, isLoaded } = useUser();
  const currentUser = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const [form, setForm] = useState({ firstName: "", lastName: "" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) setForm({ firstName: user.firstName || "", lastName: user.lastName || "" });
  }, [user?.id, user?.firstName, user?.lastName]);

  const saveProfile = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      await user.update({
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
      });
      await user.reload();
      setNotice("Профіль успішно оновлено.");
    } catch {
      setError("Не вдалося зберегти профіль. Спробуйте ще раз.");
    } finally {
      setSaving(false);
    }
  };

  if (!isLoaded || currentUser.isLoading) return <Shell><div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div></Shell>;
  if (!user && !currentUser.data) return <Shell><Empty title="Профіль доступний після входу" description="Увійдіть до FloraWise, щоб переглядати й редагувати дані профілю." action={<Link href="/sign-in" className="inline-flex rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">Увійти</Link>} /></Shell>;
  if (!user && currentUser.data) return <Shell><PreviewProfile profile={currentUser.data} /></Shell>;
  if (!user) return null;

  const displayName = user.firstName || user.username || "Користувач FloraWise";
  const initials = displayName.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
   return <Shell><PageHead eyebrow="Ваш простір" title="Профіль" description="Керуйте своїм іменем та перевіряйте дані облікового запису." /><div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]"><Panel className="p-6"><div className="flex items-center gap-4"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/40 font-mono text-lg font-bold text-foreground">{initials}</span><div><h2 className="font-serif text-2xl">{displayName}</h2><p className="mt-1 text-sm text-muted-foreground">{user.primaryEmailAddress?.emailAddress || "Електронну пошту не вказано"}</p></div></div><div className="mt-7 rounded-xl bg-muted p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Роль у FloraWise</p><p className="mt-1 text-sm">Користувач</p></div></Panel><Panel className="p-6"><h2 className="font-serif text-2xl">Особисті дані</h2><form onSubmit={saveProfile} className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Ім’я<input data-testid="input-profile-first-name" value={form.firstName} onChange={event => setForm({ ...form, firstName: event.target.value })} placeholder="Ваше ім’я" className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 font-normal outline-none focus:ring-4 focus:ring-primary/10" /></label><label className="text-sm font-semibold">Прізвище<input data-testid="input-profile-last-name" value={form.lastName} onChange={event => setForm({ ...form, lastName: event.target.value })} placeholder="Ваше прізвище" className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 font-normal outline-none focus:ring-4 focus:ring-primary/10" /></label><label className="text-sm font-semibold sm:col-span-2">Електронна пошта<input value={user.primaryEmailAddress?.emailAddress || ""} readOnly className="mt-2 w-full rounded-xl border border-input bg-muted px-4 py-3 font-normal text-muted-foreground" /></label><div className="sm:col-span-2">{notice && <p className="mb-3 rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">{notice}</p>}{error && <p className="mb-3 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}<Button type="submit" disabled={saving}>{saving ? "Зберігаємо…" : "Зберегти зміни"}</Button></div></form></Panel></div>{currentUser.data && <div className="mt-5"><SavedLocationsPanel /></div>}</Shell>;
}

function DashboardPage() {
  const q = useQueryClient(); const dash = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } }); const plants = useListPlants(); const weather = { data: dash.data?.weather ? { ...dash.data.weather, location: `${shortWeatherLocationName(dash.data.weather.location)} · ${dash.data.weather.isMock ? "Демонстраційні погодні дані" : "Актуальні погодні дані"}`, forecast: [{ ...dash.data.weather.current, temperature: roundWeatherTemperature(dash.data.weather.current.temperature), precipitation: dash.data.weather.forecast[0]?.precipitation ?? dash.data.weather.current.precipitation, precipitationProbability: dash.data.weather.forecast[0]?.precipitationProbability ?? null, windSpeed: `${dash.data.weather.current.windSpeed} м/с` }, ...dash.data.weather.forecast.slice(1)] } : { location: "Оновлюємо дані", forecast: [] } }; const complete = useCompleteTask(); const reminders = useListReminders(); const updateReminder = useUpdateReminder();
  const { displayName } = useFloraIdentity();
  const d = dash.data; const plantCount = d?.plantsCount ?? plants.data?.length ?? 0;
  const completeTask = (id: number) => complete.mutate({ id, data: { comment: "Виконано з FloraWise" } }, { onSuccess: () => { q.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); q.invalidateQueries({ queryKey: getListTasksQueryKey() }); } });
  return <Shell><PageHead eyebrow={todayLabel} title={greetingFor(displayName)} description="Подивімося, що сьогодні потребує вашої уваги." action={<Link href="/plants" data-testid="link-dashboard-add" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"><Plus size={17} /> Додати рослину</Link>} /><QueryState loading={dash.isLoading} error={!!dash.error} onRetry={() => dash.refetch()}><div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><Panel className="overflow-hidden bg-primary text-primary-foreground"><div className="flex flex-col justify-between gap-8 p-6 md:flex-row md:p-8"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] opacity-70">Сьогодні у вас</p><p className="mt-3 font-serif text-5xl">{d?.todayTasks ?? 0} <span className="text-2xl opacity-70">завдань</span></p><p className="mt-2 max-w-xs text-sm leading-6 opacity-75">{d?.overdueTasks ? `Є ${d.overdueTasks} прострочених — краще почати з них.` : "Ритм стабільний. Можна приділити час деталям."}</p></div><div className="grid h-24 w-24 place-items-center rounded-full border border-primary-foreground/30 bg-primary-foreground/10"><Droplets size={27} /><span className="sr-only">Догляд</span></div></div><div className="grid grid-cols-3 border-t border-primary-foreground/15 px-6 py-4 text-sm md:px-8"><div><span className="block font-mono text-xl">{plantCount}</span><span className="opacity-65">рослин</span></div><div><span className="block font-mono text-xl">{d?.completedTasks ?? 0}</span><span className="opacity-65">виконано</span></div><div><span className="block font-mono text-xl">{d?.highPriorityTasks ?? 0}</span><span className="opacity-65">важливих</span></div></div></Panel><Panel className="p-6"><div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Погода</p><p className="mt-2 font-serif text-3xl">{weather.data?.forecast?.[0]?.temperature ?? "—"}°</p><p className="mt-1 text-sm text-muted-foreground">{weather.data?.location || "Ваш регіон"} · {weather.data?.forecast?.[0]?.condition || "Оновлюємо дані"}</p></div><Sun className="text-accent" size={28} /></div><div className="mt-6 grid grid-cols-2 gap-3 text-xs"><div className="rounded-xl bg-muted p-3"><Droplets size={15} className="mb-2 text-primary" />Вологість <strong className="float-right">{weather.data?.forecast?.[0]?.humidity ?? "—"}%</strong></div><div className="rounded-xl bg-muted p-3"><Wind size={15} className="mb-2 text-primary" />Вітер <strong className="float-right">{weather.data?.forecast?.[0]?.windSpeed ?? "—"}</strong></div><div className="col-span-2 flex items-center justify-between rounded-xl bg-muted px-3 py-2.5"><span>Опади</span><strong>{weather.data?.forecast?.[0]?.precipitationProbability ?? "—"}% · {weather.data?.forecast?.[0]?.precipitation ?? "—"} мм</strong></div></div></Panel></div><div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><Panel className="p-6"><div className="mb-2 flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Найближче</p><h2 className="mt-2 font-serif text-2xl">План догляду</h2></div><Link href="/calendar" data-testid="link-dashboard-calendar" className="text-sm font-semibold text-primary hover:underline">Весь календар</Link></div>{d?.upcomingTasks?.length ? d.upcomingTasks.slice(0, 5).map(t => <TaskRow key={t.id} task={t} onComplete={() => completeTask(t.id)} />) : <Empty title="День вільний" description="Нових завдань немає. Саме час просто подивитися на рослини." />}</Panel><Panel className="p-6"><div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Спостереження</p><h2 className="mt-2 font-serif text-2xl">Поради для вас</h2></div><Link href="/recommendations" data-testid="link-dashboard-recommendations" className="text-sm font-semibold text-primary"><ArrowRight size={18} /></Link></div>{d?.latestRecommendations?.length ? d.latestRecommendations.slice(0, 3).map(r => <RecommendationCard key={r.id} recommendation={r} compact />) : <div className="mt-6 rounded-xl bg-secondary/60 p-5"><Lightbulb className="text-primary" size={20} /><p className="mt-3 text-sm leading-6">Коли зберемо більше спостережень, тут з’являться персональні підказки.</p></div>}</Panel></div><Panel className="mt-5 p-6"><div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Не пропустити</p><h2 className="mt-2 font-serif text-2xl">Нагадування</h2></div><Bell size={19} className="text-accent" /></div>{reminders.data?.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{reminders.data.slice(0, 4).map(r => <div key={r.id} className="flex items-center gap-3 rounded-xl bg-muted p-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-card text-primary"><Bell size={15} /></span><p className="min-w-0 flex-1 text-sm"><strong>{r.plantName}</strong><span className="block truncate text-xs text-muted-foreground">{r.message}</span></p><Button variant="ghost" onClick={() => updateReminder.mutate({ id: r.id, data: { status: "READ" } }, { onSuccess: () => q.invalidateQueries({ queryKey: getListRemindersQueryKey() }) })}>Прочитано</Button></div>)}</div> : <p className="mt-4 text-sm text-muted-foreground">Нових нагадувань немає.</p>}</Panel></QueryState></Shell>;
}
function RecommendationCard({ recommendation: r, compact = false, onApply }: { recommendation: Recommendation; compact?: boolean; onApply?: () => void }) {
  const careName = r.careType ? taskLabel[r.careType] || r.careType : "догляд";
  return <div className={`border-b border-border/70 py-4 last:border-0 ${compact ? "" : "rounded-2xl border bg-card p-5"}`}><div className="flex items-start gap-3"><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/30 text-primary"><Lightbulb size={16} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{r.plantName}</p><Badge tone={r.priority?.toLowerCase() === "high" ? "warn" : "neutral"}>{priorityLabel[r.priority] || r.priority}</Badge>{r.applied && <Badge tone="good">Зміну застосовано</Badge>}</div><p className="mt-2 text-sm leading-6 text-muted-foreground">{r.text}</p>{r.staleReason && <p role="status" className="mt-2 text-xs text-destructive">{r.staleReason}</p>}{!compact && <><p className="mt-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Чому:</strong> {r.explanation}</p>{r.type === "WEATHER_RESCHEDULE" && <div className="mt-3 rounded-xl bg-muted/40 px-3 py-2 text-xs leading-5"><p>Завдання: {careName}</p>{r.originalDate && <p>Поточна дата: {fmtDayMonth(r.originalDate)}</p>}{r.suggestedDate ? <p className="font-semibold text-primary">Рекомендована дата: {fmtDayMonth(r.suggestedDate)}</p> : <p>Рекомендованої дати немає в доступному прогнозі.</p>}</div>}{onApply && r.actionable && !r.applied && <Button variant="soft" onClick={onApply} className="mt-4">Застосувати зміну <ArrowRight size={15} /></Button>}</>}</div></div></div>;
}

function PlantsPage() {
  const q = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<PlantCategory | "">("");
  const [filter, setFilter] = useState<"all" | "overdue" | "highPriority">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Plant | null>(null);
  const [planFor, setPlanFor] = useState<Plant | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const plants = useListPlants({ category: category || undefined, search: search || undefined, overdue: filter === "overdue" ? true : undefined, highPriority: filter === "highPriority" ? true : undefined });
  const remove = useDeletePlant();
  const list = plants.data || [];
  const filters = [["all", "Усі рослини"], ["overdue", "Прострочений догляд"], ["highPriority", "Високий пріоритет"]] as const;
  return <Shell><PageHead eyebrow="Моя колекція" title="Рослини" description={`${list.length} рослин у вашому просторі. Кожна має свій темп.`} action={<Button onClick={() => { setEditing(null); setShowAdd(true); }} testId="button-add-plant"><Plus size={17} /> Додати рослину</Button>} />
    <div className="mb-3 flex flex-col gap-3 sm:flex-row"><CategoryFilter value={category} onChange={setCategory} /><label className="relative flex-1"><Search className="absolute left-3 top-3 text-muted-foreground" size={18} /><input data-testid="input-search-plants" value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук за назвою або видом" className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-4 focus:ring-primary/10" /></label></div>
    <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Фільтр догляду">{filters.map(([k, label]) => <button key={k} type="button" data-testid={`filter-plants-${k}`} aria-pressed={filter === k} onClick={() => setFilter(k)} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${filter === k ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}>{label}</button>)}</div>
    {deleteError && <div className="mb-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">{deleteError}</div>}
    {(showAdd || editing) && <PlantForm key={editing?.id ?? "new"} plant={editing} onCancel={() => { setShowAdd(false); setEditing(null); }} onDone={(saved, created) => { setShowAdd(false); setEditing(null); if (created) setPlanFor(saved); }} />}
    {planFor && <CarePlanDialog plantId={planFor.id} plantName={planFor.name} onClose={() => setPlanFor(null)} />}
    <QueryState loading={plants.isLoading} error={!!plants.error} onRetry={() => plants.refetch()}>{list.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{list.map((p, i) => <PlantCard key={p.id} plant={p} index={i} onEdit={() => { setEditing(p); setShowAdd(false); }} onDelete={() => { if (window.confirm(`Видалити ${p.name} з колекції?`)) { setDeleteError(""); remove.mutate({ id: p.id }, { onSuccess: () => q.invalidateQueries({ queryKey: getListPlantsQueryKey() }), onError: () => setDeleteError("Не вдалося видалити рослину. Спробуйте ще раз.") }); } }} />)}</div> : filter !== "all" || search ? <Empty title="Нічого не знайдено" description="Змініть фільтр або пошуковий запит." action={<Button variant="soft" onClick={() => { setFilter("all"); setSearch(""); }}>Скинути фільтри</Button>} /> : <Empty title="Колекція ще порожня" description="Додайте першу рослину, щоб FloraWise зміг налаштувати її ритм догляду." action={<Button onClick={() => setShowAdd(true)}><Plus size={17} /> Додати першу рослину</Button>} />}</QueryState></Shell>;
}
function PlantCard({ plant: p, index, onEdit, onDelete }: { plant: Plant; index: number; onEdit: () => void; onDelete: () => void }) {
  const [, setLocation] = useLocation(); const colors = ["#d9e0ce", "#eadfc9", "#d8e5e1", "#e7d7c9"]; const plantIcon = index % 2 ? <Flower2 size={68} strokeWidth={1} /> : <Sprout size={74} strokeWidth={1} />;
  return <article data-testid={`card-plant-${p.id}`} className="group overflow-hidden rounded-2xl border border-card-border bg-card shadow-[0_10px_30px_hsl(154_25%_18%_/.04)] transition-transform hover:-translate-y-1"><button data-testid={`button-open-plant-${p.id}`} onClick={() => setLocation(`/plants/${p.id}`)} className="block w-full text-left"><div className="relative flex h-48 items-center justify-center overflow-hidden" style={{ backgroundColor: colors[index % colors.length] }}>{p.photoUrl ? <PlantPhoto src={p.photoUrl} alt={p.name} className="h-full w-full object-cover" /> : <div className="text-primary/70">{plantIcon}</div>}<span className="absolute left-4 top-4 rounded-full bg-card/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider backdrop-blur">{p.location} · {envLabel[p.environmentType] || p.environmentType}</span></div><div className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-serif text-2xl">{p.name}</h2>{p.speciesId == null ? <p data-testid={`text-custom-plant-${p.id}`} className="mt-1 text-sm text-muted-foreground">Рослина поза довідником</p> : <p className="mt-1 text-sm text-muted-foreground">{p.speciesName}</p>}<p className="mt-1 text-xs text-muted-foreground">{p.speciesId == null && isCategory(p.category) ? CATEGORY_LABELS[p.category] : p.categoryLabel}</p></div><span className={`mt-1 h-2.5 w-2.5 rounded-full ${p.careStatus === "OVERDUE" ? "bg-destructive" : p.careStatus === "NO_PLAN" ? "bg-muted-foreground/40" : "bg-primary"}`} /></div><div className="mt-5 flex items-center justify-between border-t border-border/70 pt-4 text-xs"><span className="text-muted-foreground">{p.nextTask ? `${taskLabel[p.nextTaskType || ""] || p.nextTaskType || "Догляд"} · ${fmt(p.nextTask)}` : "Немає запланованого"}</span><span className="font-semibold text-primary">{p.careStatus === "OVERDUE" ? "Потребує уваги" : p.careStatus === "NO_PLAN" ? "Без плану" : "У ритмі"}{p.hasHighPriorityTasks && p.careStatus !== "OVERDUE" ? " · пріоритет" : ""}</span></div></div></button><div className="flex justify-end gap-1 border-t border-border/60 px-4 py-2"><Button variant="ghost" onClick={onEdit}><Pencil size={14} /> Редагувати</Button><Button variant="danger" onClick={onDelete}><Trash2 size={14} /></Button></div></article>;
}

function PlantDetailPage() {
  const { id } = useParams<{ id: string }>(); const plantId = Number(id); const q = useQueryClient(); const { data: plant, isLoading, error, refetch } = useGetPlant(plantId, { query: { queryKey: getGetPlantQueryKey(plantId) } }); const generate = useGenerateRecommendation(); const complete = useCompleteTask(); const [planOpen, setPlanOpen] = useState(false); const [genResult, setGenResult] = useState<RecommendationResult | null>(null); const [genError, setGenError] = useState(""); const [notice, setNotice] = useState("");
  if (!plant) return <Shell><QueryState loading={isLoading} error={!!error} onRetry={() => refetch()}><Empty title="Рослину не знайдено" description="Можливо, вона була видалена або посилання застаріло." /></QueryState></Shell>;
  return <Shell><Link href="/plants" data-testid="link-back-plants" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ChevronLeft size={17} /> Усі рослини</Link><PageHead eyebrow={plant.location} title={plant.name} description={plant.speciesId == null ? `Рослина поза довідником · ${isCategory(plant.category) ? CATEGORY_LABELS[plant.category] : ""}` : plant.speciesName ?? undefined} action={<div className="flex flex-wrap gap-2"><Button variant="soft" onClick={() => setPlanOpen(true)} testId="button-open-care-plan"><CalendarDays size={16} /> План догляду</Button><Button onClick={() => { generate.mutate({ data: { plantId } }, { onError: () => setGenError("Не вдалося отримати поради. Спробуйте ще раз."), onSuccess: res => { setGenError(""); setGenResult(res); setNotice(res.recommendations.length ? "Нову пораду створено" : "Нових порад немає"); q.invalidateQueries({ queryKey: getGetPlantQueryKey(plantId) }); } }); }} disabled={generate.isPending}><Zap size={16} /> {generate.isPending ? "Аналізуємо…" : "Запитати пораду"}</Button></div>} />{planOpen && <CarePlanDialog plantId={plantId} plantName={plant.name} onClose={() => setPlanOpen(false)} />}{genError && <div role="alert" className="mb-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{genError}</div>}{notice && <div className="mb-5 flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-sm text-primary"><CheckCircle2 size={17} /> {notice}</div>}{genResult && <Panel className="mb-5 p-6" ><div data-testid="panel-generated-recommendations"><div className="flex items-start justify-between gap-3"><h2 className="font-serif text-2xl">Результат аналізу</h2><IconButton label="закрити результат" onClick={() => setGenResult(null)}><X size={16} /></IconButton></div><p className="mt-1 text-xs text-muted-foreground">Локація погоди: {genResult.weather.location}{genResult.weather.isMock ? " · орієнтовні дані" : ""}</p>{genResult.warning && <div role="status" className="mt-3 rounded-xl bg-accent/25 p-3 text-sm">{genResult.warning}</div>}{genResult.recommendations.length ? <div className="mt-3">{genResult.recommendations.map(r => <RecommendationCard key={r.id} recommendation={r} />)}</div> : <p className="mt-3 text-sm text-muted-foreground">Зараз змін у догляді не потрібно.</p>}</div></Panel>}<div className="grid gap-5 lg:grid-cols-[.85fr_1.15fr]"><Panel className="overflow-hidden"><div className="flex h-64 items-center justify-center bg-[#d9e0ce] text-primary/70">{plant.photoUrl ? <PlantPhoto src={plant.photoUrl} alt={plant.name} className="h-full w-full object-cover" /> : <Sprout size={100} strokeWidth={1} />}</div><div className="p-6"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Про рослину</p><p className="mt-3 text-sm leading-7 text-muted-foreground">{plant.speciesId == null ? <span data-testid="text-custom-plant-note">Видових даних немає. Поради базуються на категорії рослини та умовах вирощування.</span> : plant.species?.description || "Деталі виду з’являться тут після синхронізації довідника."}</p>{plant.speciesId != null && plant.species && <><div className="mt-6 grid grid-cols-2 gap-3">{plantSpeciesQuickFacts(plant.species).map(([a,b]) => <div key={a} className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">{a}</p><p className="mt-1 text-sm font-semibold">{b}</p></div>)}</div>{plant.species.wateringRecommendations?.trim() && <p data-testid="text-watering-guidance" className="mt-3 rounded-xl bg-muted/60 p-3 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground">Порада щодо поливу: </span>{plant.species.wateringRecommendations}</p>}</>}</div></Panel><div className="space-y-5"><Panel className="p-6"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Стан</p><div className="mt-3 flex flex-wrap gap-2"><Badge tone={plant.careStatus === "OVERDUE" ? "danger" : plant.careStatus === "NO_PLAN" ? "neutral" : "good"}>{plant.careStatus === "OVERDUE" ? "Є прострочений догляд" : plant.careStatus === "NO_PLAN" ? "Плану догляду немає" : "Догляд за планом"}</Badge>{plant.hasHighPriorityTasks && <Badge tone="warn">Високий пріоритет</Badge>}<Badge>{envLabel[plant.environmentType] || plant.environmentType}</Badge></div><div className="mt-5 grid grid-cols-3 gap-4">{[["Виконано", plant.stats?.completedTasks ?? 0], ["Усього", plant.stats?.totalTasks ?? 0], ["Ритм", `${Math.round(plant.stats?.completionRate ?? 0)}%`]].map(([a,b]) => <div key={a}><p className="font-mono text-2xl text-primary">{b}</p><p className="mt-1 text-xs text-muted-foreground">{a}</p></div>)}</div></Panel><Panel className="p-6"><div className="flex items-center justify-between"><h2 className="font-serif text-2xl">Найближчий догляд</h2><Link href="/calendar" data-testid="link-detail-calendar" className="text-sm font-semibold text-primary">Календар</Link></div>{plant.upcomingTasks?.length ? plant.upcomingTasks.slice(0, 4).map(t => <TaskRow key={t.id} task={t} onComplete={() => complete.mutate({ id: t.id, data: {} }, { onSuccess: () => { setNotice("Завдання виконано"); Promise.all([getGetPlantQueryKey(plantId), getListTasksQueryKey(), getListPlantsQueryKey(), getGetDashboardQueryKey(), getListRemindersQueryKey(), getListReportsQueryKey()].map(queryKey => q.invalidateQueries({ queryKey }))); q.invalidateQueries({ queryKey: getListCareHistoryQueryKey() }); q.invalidateQueries({ queryKey: getGetStatisticsQueryKey() }); } })} />) : <p className="mt-5 text-sm text-muted-foreground">Наразі все зроблено.</p>}</Panel></div></div>{plant.speciesId != null && plant.species && <PlantKnowledge species={plant.species} />}</Shell>;
}

function plantSpeciesQuickFacts(species: PlantSpecies): Array<[string, string]> {
  const range = (min: number | null, max: number | null, suffix: string) => {
    if (min != null && max != null) return `${min}–${max}${suffix}`;
    if (min != null) return `від ${min}${suffix}`;
    if (max != null) return `до ${max}${suffix}`;
    return "Дані не визначені";
  };
  return [
    ["Температура", range(species.optimalTempMin, species.optimalTempMax, "°C")],
    ["Вологість", species.optimalHumidity != null ? `${species.optimalHumidity}%` : range(species.humidityMin, species.humidityMax, "%")],
    ["Полив", plantWateringSummary(species)],
    ["Світло", species.lightRequirements?.trim() || "Дані не визначені"],
  ];
}

function plantWateringSummary(species: PlantSpecies): string {
  return species.wateringFrequencyDays != null
    ? `орієнтовно кожні ${species.wateringFrequencyDays} днів`
    : species.wateringRecommendations?.trim() ? "за потреби" : "Дані не визначені";
}

function PlantKnowledge({ species }: { species: PlantSpecies }) {
  const [open, setOpen] = useState(false);
  return <Panel className="mt-5 p-6"><button type="button" data-testid="button-toggle-knowledge" onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between text-left"><span className="font-serif text-2xl">Знання про вид</span><ChevronDown size={18} className={`text-primary transition-transform ${open ? "rotate-180" : ""}`} /></button>{open && <div className="mt-5"><SpeciesDetails species={species} /></div>}</Panel>;
}
function CalendarPage() {
  const q = useQueryClient();
  const [view, setView] = useState<"list" | "month">("list");
  const [show, setShow] = useState(false);
  const [type, setType] = useState<CareType | "">("");
  const [status, setStatus] = useState("");
  const [plantId, setPlantId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const tasks = useListTasks({ type: type || undefined, status: status || undefined, plantId: plantId ? Number(plantId) : undefined, from: from || undefined, to: to || undefined });
  const plants = useListPlants();
  const complete = useCompleteTask(); const del = useDeleteTask(); const update = useUpdateTask();
  const refresh = () => q.invalidateQueries();
  const fail = (error: unknown) => setError(errMsg(error, "Не вдалося змінити завдання."));
  const control = "rounded-xl border border-input bg-card px-3 py-2 text-sm";
  return <Shell><PageHead eyebrow="Ваш ритм" title="Календар догляду" description="Плануйте застосовні дії та переглядайте всю історію догляду." action={<Button onClick={() => setShow(!show)}><Plus size={17} /> Нове завдання</Button>} />
    {show && <Panel className="mb-6 p-6"><h2 className="font-serif text-2xl">Запланувати догляд</h2><TaskCreateForm onDone={() => setShow(false)} /></Panel>}
    <div className="mb-5 flex flex-wrap gap-2">
      <Button variant={view === "list" ? "soft" : "ghost"} onClick={() => setView("list")}>Список</Button><Button variant={view === "month" ? "soft" : "ghost"} onClick={() => setView("month")}>Місяць</Button>
      <select aria-label="Фільтр типу догляду" data-testid="filter-task-type" value={type} onChange={e => setType(e.target.value as CareType | "")} className={control}><option value="">Усі типи</option>{CARE_TYPES.map(type => <option key={type} value={type}>{taskLabel[type]}</option>)}</select>
      <select aria-label="Фільтр статусу" value={status} onChange={e => setStatus(e.target.value)} className={control}><option value="">Усі статуси</option><option value="PLANNED">Заплановані</option><option value="POSTPONED">Перенесені</option><option value="COMPLETED">Виконані</option><option value="CANCELLED">Скасовані</option></select>
      <select aria-label="Фільтр рослини" value={plantId} onChange={e => setPlantId(e.target.value)} className={control}><option value="">Усі рослини</option>{plants.data?.map(plant => <option key={plant.id} value={plant.id}>{plant.name}</option>)}</select>
      <label className="text-sm">Від <input aria-label="Дата від" type="date" value={from} onChange={e => setFrom(e.target.value)} className={control} /></label>
      <label className="text-sm">До <input aria-label="Дата до" type="date" value={to} onChange={e => setTo(e.target.value)} className={control} /></label>
    </div>
    {error && <p role="alert" className="mb-4 text-destructive">{error}</p>}
    <QueryState loading={tasks.isLoading} error={!!tasks.error} onRetry={() => tasks.refetch()}>
      {view === "month" ? <MonthGrid tasks={tasks.data ?? []} /> : <Panel className="p-6"><h2 className="font-serif text-2xl">Завдання догляду</h2>
        {tasks.data?.length ? tasks.data.map(task => <TaskRow key={task.id} task={task}
          onComplete={() => complete.mutate({ id: task.id, data: {} }, { onSuccess: refresh, onError: fail })}
          onPostpone={["PLANNED", "POSTPONED"].includes(task.status) && plants.data?.find(plant => plant.id === task.plantId)?.allowedCareTypes?.includes(task.type as CareType) ? () => {
            if (window.confirm("Перенести це завдання на один день?")) update.mutate({ id: task.id, data: { scheduledDate: new Date(Date.parse(task.scheduledDate) + 86400000).toISOString().slice(0, 10), status: "POSTPONED" } }, { onSuccess: refresh, onError: fail });
          } : undefined}
          onDelete={["PLANNED", "POSTPONED"].includes(task.status) ? () => { if (window.confirm("Скасувати це завдання?")) del.mutate({ id: task.id }, { onSuccess: refresh, onError: fail }); } : undefined}
        />) : <Empty title="Завдань не знайдено" description="Змініть фільтри або додайте застосовний догляд." />}
      </Panel>}
    </QueryState>
  </Shell>;
}
function MonthGrid({ tasks }: { tasks: CareTask[] }) { const days = Array.from({ length: 31 }, (_, i) => i + 1); return <Panel className="p-4 md:p-6"><div className="mb-4 grid grid-cols-7 gap-1 text-center font-mono text-[10px] uppercase text-muted-foreground">{["Пн","Вт","Ср","Чт","Пт","Сб","Нд"].map(d => <span key={d} className="py-2">{d}</span>)}</div><div className="grid grid-cols-7 gap-1">{days.map(d => { const count = tasks.filter(t => new Date(t.scheduledDate).getDate() === d).length; return <div key={d} className={`min-h-16 rounded-xl border p-2 text-sm ${d === 12 ? "border-primary bg-primary/10" : "border-border/60 bg-background"}`}><span className="font-mono text-xs">{d}</span>{count > 0 && <span className="mt-2 block rounded-md bg-accent/50 px-1 py-0.5 text-center text-[10px] font-semibold">{count} {count === 1 ? "дія" : "дії"}</span>}</div>; })}</div></Panel>; }

function HistoryPage() { const [type, setType] = useState(""); const history = useListCareHistory({ taskType: type || undefined }); return <Shell><PageHead eyebrow="Слід вашої турботи" title="Історія" description="Поверніться до зробленого — так добре видно справжній прогрес." /><div className="mb-6 flex gap-2"><select data-testid="select-history-type" value={type} onChange={e => setType(e.target.value)} className="rounded-xl border border-input bg-card px-4 py-2.5 text-sm"><option value="">Усі дії</option><option value="WATERING">Полив</option><option value="FERTILIZING">Підживлення</option><option value="PRUNING">Обрізка</option></select></div><QueryState loading={history.isLoading} error={!!history.error} onRetry={() => history.refetch()}>{history.data?.length ? <Panel className="divide-y divide-border/70 p-6">{history.data.map((h: CareHistory) => <div key={h.id} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Check size={18} /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{taskLabel[h.type] || h.type} · {h.plantName}</p><p className="mt-1 text-xs text-muted-foreground">{fmtLong(h.completedAt)} · Планували на {fmt(h.plannedDate)}</p>{h.comment && <p className="mt-2 text-sm text-muted-foreground">{h.comment}</p>}</div><Badge tone="good">Виконано</Badge></div>)}</Panel> : <Empty title="Історія ще чиста" description="Виконані завдання з’являться тут — це ваш особистий журнал турботи." />}</QueryState></Shell>; }

function RecommendationsPage() {
  const q = useQueryClient();
  const [plantId, setPlantId] = useState("");
  const [error, setError] = useState("");
  const [rainScenarioEnabled, setRainScenarioEnabled] = useState(false);
  const recs = useListRecommendations({ plantId: plantId ? Number(plantId) : undefined });
  const plants = useListPlants();
  const generate = useGenerateRecommendation();
  const apply = useApplyRecommendation();
  const applyAdvice = (recommendation: Recommendation) => {
    const careName = recommendation.careType ? taskLabel[recommendation.careType] || recommendation.careType : "догляд";
    if (!recommendation.actionable || apply.isPending || !window.confirm(`Застосувати зміну для «${recommendation.plantName}»: ${careName}, ${fmtDayMonth(recommendation.originalDate)} → ${fmtDayMonth(recommendation.suggestedDate)}?`)) return;
    setError("");
    apply.mutate({ id: recommendation.id }, {
      onSuccess: () => q.invalidateQueries(),
      onError: failure => { setError(errMsg(failure, "Не вдалося застосувати пораду")); recs.refetch(); },
    });
  };
  return <Shell>
    <PageHead eyebrow="Погода + спостереження" title="Поради" description="Не універсальні правила, а пояснені підказки для вашого дому." action={<div className="flex gap-2">
      <select data-testid="select-recommendation-plant" value={plantId} onChange={event => { setPlantId(event.target.value); setError(""); }} className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm">
        <option value="">Усі рослини</option>{(plants.data || []).map(plant => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
      </select>
      <Button onClick={() => {
        const id = Number(plantId || plants.data?.[0]?.id);
        if (id) { setError(""); generate.mutate({ data: { plantId: id, ...(rainScenarioEnabled ? { weatherScenario: "RAIN_TOMORROW" as const } : {}) } }, {
          onSuccess: () => q.invalidateQueries({ queryKey: getListRecommendationsQueryKey() }),
          onError: failure => setError(errMsg(failure, "Не вдалося створити пораду")),
        }); }
      }} disabled={generate.isPending || !plants.data?.length}><Zap size={16} /> {generate.isPending ? "Аналізуємо…" : "Нова порада"}</Button>
    </div>} />
    {import.meta.env.DEV && <Panel className="mb-5 p-4"><label className="flex cursor-pointer items-start gap-3 text-sm"><input data-testid="toggle-rain-weather-scenario" type="checkbox" checked={rainScenarioEnabled} onChange={event => setRainScenarioEnabled(event.target.checked)} className="mt-1 accent-primary" /><span><strong>Тестовий сценарій дощу</strong><span className="mt-1 block text-xs text-muted-foreground">Завтра — 10,3 мм опадів, післязавтра — сухо. Працює лише в режимі розробки; створіть для вибраної рослини полив на завтра.</span></span></label></Panel>}
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <QueryState loading={recs.isLoading} error={!!recs.error} onRetry={() => recs.refetch()}>
      {recs.data?.length ? <div className="grid gap-4 lg:grid-cols-2">{recs.data.map(recommendation => <RecommendationCard key={recommendation.id} recommendation={recommendation} onApply={() => applyAdvice(recommendation)} />)}</div> : <Empty title="Порад ще немає" description="Оберіть рослину й попросіть FloraWise подивитися на погоду та її ритм." />}
    </QueryState>
  </Shell>;
}

function DirectoryPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<PlantCategory | "">("");
  const [editor, setEditor] = useState<PlantSpecies | "new" | null>(null);
  const species = useListSpecies({ category: category || undefined, search: search || undefined });
  const me = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const isAdmin = me.data?.role === "ADMIN";
  return <Shell><PageHead eyebrow="Знання, без перевантаження" title="Довідник рослин" description="Зрозумілі характеристики й рекомендації для видів, які живуть поруч." action={<div className="flex flex-wrap gap-2"><CategoryFilter value={category} onChange={setCategory} />{isAdmin && <Button onClick={() => setEditor("new")} testId="button-new-species"><Plus size={17} /> Новий вид</Button>}</div>} /><div className="relative mb-7 max-w-xl"><Search className="absolute left-3 top-3 text-muted-foreground" size={18} /><input data-testid="input-search-directory" value={search} onChange={e => setSearch(e.target.value)} placeholder="Знайти вид рослини" className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-4 focus:ring-primary/10" /></div>{editor && <SpeciesEditor key={editor === "new" ? "new" : editor.id} species={editor === "new" ? null : editor} onClose={() => setEditor(null)} />}<QueryState loading={species.isLoading} error={!!species.error} onRetry={() => species.refetch()}>{species.data?.length ? <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">{species.data.map((s, i) => <SpeciesCard key={s.id} species={s} index={i} onEdit={isAdmin ? () => setEditor(s) : undefined} />)}</div> : <Empty title="Вид не знайдено" description="Спробуйте іншу назву або пошукайте ширше." />}</QueryState></Shell>;
}
function SpeciesCard({ species: s, index, onEdit }: { species: PlantSpecies; index: number; onEdit?: () => void }) {
  const [open, setOpen] = useState(false); const backgrounds = ["#d9e0ce","#eadfc9","#d8e5e1"];
  return <Panel className="overflow-hidden"><button data-testid={`button-open-species-${s.id}`} onClick={() => setOpen(!open)} className="w-full text-left"><div className="flex h-32 items-end justify-between px-5 pb-4" style={{ backgroundColor: backgrounds[index % 3] }}>{s.imageUrl ? <img src={s.imageUrl} alt={s.name} className="h-full w-full object-cover" /> : <Sprout size={64} className="text-primary/50" strokeWidth={1} />}<ChevronDown size={18} className={`text-primary transition-transform ${open ? "rotate-180" : ""}`} /></div><div className="p-5"><h2 className="font-serif text-2xl">{s.name}</h2><p className="mt-1 text-xs text-muted-foreground">{CATEGORY_LABELS[s.category]}</p>{s.scientificName && <p className="text-xs italic text-muted-foreground">{s.scientificName}</p>}<p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{s.description}</p></div></button>{open && <div className="border-t border-border p-5 pt-4"><SpeciesDetails species={s} /></div>}{onEdit && <div className="flex justify-end border-t border-border/60 px-4 py-2"><Button variant="ghost" onClick={onEdit} testId={`button-edit-species-${s.id}`}><Pencil size={14} /> Редагувати знання</Button></div>}</Panel>;
}

function StatisticsPage() { const stats = useGetStatistics(); return <Shell><PageHead eyebrow="Ваші закономірності" title="Статистика" description="Цифри без оцінок — щоб легше помічати, що працює." /><QueryState loading={stats.isLoading} error={!!stats.error} onRetry={() => stats.refetch()}>{stats.data ? <StatsContent stats={stats.data} /> : <Empty title="Замало даних" description="Виконуйте завдання, і тут поступово з’явиться ваш ритм." />}</QueryState></Shell>; }
function StatsContent({ stats: s }: { stats: Statistics }) {
  const max = Math.max(...(s.byType || []).map(x => x.value), 1);
  const cards: Array<{ label: string; value: string | number; Icon: typeof CalendarDays }> = [
    { label: "Всього завдань", value: s.totalPlanned, Icon: CalendarDays },
    { label: "Виконано", value: s.completed, Icon: CheckCircle2 },
    { label: "Прострочено", value: s.overdue, Icon: CircleAlert },
    { label: "Ритм виконання", value: `${Math.round(s.completionRate)}%`, Icon: TrendingUp },
  ];
  return <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, Icon }) => <Panel key={label} className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-3 font-mono text-3xl text-primary">{value}</p></div><Icon size={20} className="text-accent" /></div></Panel>)}</div><div className="mt-5 grid gap-5 lg:grid-cols-2"><Panel className="p-6"><h2 className="font-serif text-2xl">Дії за типом</h2><div className="mt-6 space-y-5">{(s.byType || []).map(x => <div key={x.label}><div className="mb-2 flex justify-between text-sm"><span>{taskLabel[x.label] || x.label}</span><span className="font-mono text-muted-foreground">{x.value}</span></div><div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${x.value / max * 100}%` }} /></div></div>)}</div></Panel><Panel className="p-6"><h2 className="font-serif text-2xl">По рослинах</h2><div className="mt-6 space-y-4">{(s.byPlant || []).map(x => <div key={x.label} className="flex items-center justify-between border-b border-border/70 pb-3 text-sm last:border-0"><span>{x.label}</span><span className="rounded-full bg-secondary px-3 py-1 font-mono text-xs">{x.value}</span></div>)}</div></Panel></div></>;
}

function ReportsPage() { const q = useQueryClient(); const reports = useListReports(); const create = useCreateReport(); const [form, setForm] = useState({ periodStart: monthStart, periodEnd: monthEnd }); return <Shell><PageHead eyebrow="Підсумки сезону" title="Звіти" description="Збережені зрізи вашого догляду — для спокійного перегляду або друку." action={<Button onClick={() => create.mutate({ data: form }, { onSuccess: () => q.invalidateQueries({ queryKey: getListReportsQueryKey() }) })} disabled={create.isPending}><Plus size={17} /> {create.isPending ? "Готуємо…" : "Створити звіт"}</Button>} /><Panel className="mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-end"><label className="text-sm font-semibold">Від<input data-testid="input-report-start" type="date" value={form.periodStart} onChange={e => setForm({ ...form, periodStart: e.target.value })} className="mt-2 block rounded-xl border border-input bg-background px-3 py-2 text-sm" /></label><label className="text-sm font-semibold">До<input data-testid="input-report-end" type="date" value={form.periodEnd} onChange={e => setForm({ ...form, periodEnd: e.target.value })} className="mt-2 block rounded-xl border border-input bg-background px-3 py-2 text-sm" /></label><p className="text-xs text-muted-foreground">Новий звіт збере фактичні дані за обраний період.</p></Panel><QueryState loading={reports.isLoading} error={!!reports.error} onRetry={() => reports.refetch()}>{reports.data?.length ? <div className="space-y-4">{reports.data.map(r => <ReportCard key={r.id} report={r} />)}</div> : <Empty title="Звітів ще немає" description="Створіть перший звіт, щоб побачити повну картину догляду." />}</QueryState></Shell>; }
function ReportCard({ report: r }: { report: Report }) { return <Panel className="p-6"><div className="flex flex-col justify-between gap-5 md:flex-row md:items-start"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">{fmt(r.periodStart)} — {fmt(r.periodEnd)}</p><h2 className="mt-2 font-serif text-2xl">Звіт про догляд</h2><p className="mt-2 text-sm text-muted-foreground">Створено {fmtLong(r.createdAt)}</p></div><Button variant="soft" onClick={() => window.print()}><FileText size={16} /> Друкувати</Button></div><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Завдань",r.taskCount],["Виконано",r.completed],["Прострочено",r.overdue],["Ритм",`${Math.round(r.completionRate)}%`]].map(([a,b]) => <div key={String(a)} className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">{a}</p><p className="mt-1 font-mono text-xl text-primary">{b}</p></div>)}</div><p className="mt-5 text-sm leading-6 text-muted-foreground">{r.recommendationSummary}</p></Panel>; }

function AdminPage() {
  const q = useQueryClient();
  const user = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey() } });
  const species = useListSpecies();
  const del = useDeleteSpecies();
  const [editor, setEditor] = useState<PlantSpecies | "new" | null>(null);
  const [error, setError] = useState("");
  if (user.isLoading) return <Shell><Skeleton className="h-40" /></Shell>;
  if (user.data?.role !== "ADMIN") return <Shell><Empty title="Розділ недоступний" description="Адміністративні інструменти доступні лише адміністраторам." action={<ShieldCheck className="mx-auto text-primary" />} /></Shell>;
  return <Shell><PageHead eyebrow="Адміністрування" title="Керування видами" description="Оновлюйте базу рослин, правила догляду та джерела, якими користується весь FloraWise." action={<Button onClick={() => setEditor("new")} testId="button-new-species"><Plus size={17} /> Новий вид</Button>} />
    {error && <div role="alert" className="mb-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {editor && <SpeciesEditor key={editor === "new" ? "new" : editor.id} species={editor === "new" ? null : editor} onClose={() => setEditor(null)} />}
    <QueryState loading={species.isLoading} error={!!species.error} onRetry={() => species.refetch()}><div className="space-y-3">{(species.data || []).map(s => <Panel key={s.id} className="flex items-center gap-4 p-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><Sprout size={19} /></span><div className="flex-1"><p className="font-semibold">{s.name}</p><p className="text-xs text-muted-foreground">Полив: {plantWateringSummary(s)}</p>{s.wateringCheckIntervalDays != null && <p className="text-xs text-muted-foreground">Перевірка умов: кожні {s.wateringCheckIntervalDays} дн.</p>}</div><Button variant="ghost" testId={`button-edit-species-${s.id}`} onClick={() => setEditor(s)}><Pencil size={15} /></Button><Button variant="danger" testId={`button-delete-species-${s.id}`} onClick={() => { if (window.confirm(`Видалити ${s.name}?`)) { setError(""); del.mutate({ id: s.id }, { onSuccess: () => q.invalidateQueries({ queryKey: getListSpeciesQueryKey() }), onError: () => setError("Не вдалося видалити вид. Імовірно, він використовується рослинами.") }); } }}><Trash2 size={15} /></Button></Panel>)}</div></QueryState></Shell>;
}
function HomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="grid min-h-[100dvh] place-items-center bg-background"><Skeleton className="h-10 w-40" /></div>;
  return isSignedIn ? <Redirect to="/dashboard" /> : <Landing />;
}

function Router() {
  return <ErrorBoundary><Switch>
    <Route path="/" component={HomeRoute} />
    <Route path="/sign-in/*?" component={SignInPage} />
     <Route path="/sign-up/*?" component={SignUpPage} />
     <Route path="/profile" component={ProfilePage} />
    <Route path="/dashboard" component={DashboardPage} />
    <Route path="/plants" component={PlantsPage} />
    <Route path="/plants/:id" component={PlantDetailPage} />
    <Route path="/calendar" component={CalendarPage} />
    <Route path="/history" component={HistoryPage} />
    <Route path="/recommendations" component={RecommendationsPage} />
    <Route path="/directory" component={DirectoryPage} />
    <Route path="/statistics" component={StatisticsPage} />
    <Route path="/reports" component={ReportsPage} />
    <Route path="/admin" component={AdminPage} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary>;
}

function ClerkQueryCacheInvalidator() {
  const { addListener } = useClerk();
  const q = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) {
        q.clear();
      }
      if (userId) window.localStorage.removeItem(previewSignedOutKey);
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, q]);
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    // Both packages use Clerk's localization schema, but pnpm resolves separate @clerk/shared type copies.
    localization={authLocalization as unknown as ComponentProps<typeof ClerkProvider>["localization"]}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkQueryCacheInvalidator />
      <Router />
    </QueryClientProvider>
  </ClerkProvider>;
}

export default function App() {
  if (!clerkPubKey) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}