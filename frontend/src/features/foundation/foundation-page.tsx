import { Link } from 'react-router-dom';
import { LogoMark } from '../../components/logo-mark';
import { StatusDot } from '../../components/status-dot';
import { API_DOCS_URL } from '../../services/runtime-config';

const capabilities = [
  {
    title: 'Theo dõi xuyên suốt',
    description: 'Một luồng trạng thái đáng tin cậy từ lúc tạo vận đơn đến giao hoàn tất.',
    icon: 'route',
  },
  {
    title: 'Điều phối rõ ràng',
    description: 'Phân công tài xế, kho và trách nhiệm xử lý theo từng chặng vận chuyển.',
    icon: 'dispatch',
  },
  {
    title: 'Dữ liệu nhất quán',
    description: 'Lịch sử nghiệp vụ, tracking và đối soát được thiết kế làm nguồn tin cậy.',
    icon: 'data',
  },
] as const;

const foundationItems = [
  ['Web application', 'React + TypeScript'],
  ['API platform', 'NestJS + Swagger'],
  ['Data layer', 'Neon + Prisma'],
  ['Realtime foundation', 'Redis'],
] as const;

function CapabilityIcon({ name }: { name: (typeof capabilities)[number]['icon'] }) {
  if (name === 'dispatch') {
    return <path d="M6 8.5h12M6 12h7m-7 3.5h4M16.5 14l1.5 1.5 3-3" />;
  }

  if (name === 'data') {
    return (
      <path d="M5 7c0-1.1 3.1-2 7-2s7 .9 7 2-3.1 2-7 2-7-.9-7-2Zm0 0v5c0 1.1 3.1 2 7 2s7-.9 7-2V7m-14 5v5c0 1.1 3.1 2 7 2s7-.9 7-2v-5" />
    );
  }

  return <path d="M4 17h4l2.5-9 3 8 2-5 1.5 3H20M6 5.5h3M15 5.5h3" />;
}

export function FoundationPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <a className="skip-link" href="#main-content">
        Bỏ qua điều hướng
      </a>

      <header className="border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            className="focus-ring inline-flex min-h-11 items-center gap-3 rounded-xl font-bold text-ink"
            to="/"
          >
            <LogoMark className="size-10 text-primary" />
            <span className="hidden sm:inline">Logistics Operations</span>
            <span className="sm:hidden">Logistics</span>
          </Link>

          <Link
            className="focus-ring inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-on-primary shadow-sm transition-colors hover:bg-primary-strong active:bg-primary-strong"
            to="/login"
          >
            Đăng nhập
          </Link>
        </div>
      </header>

      <main id="main-content">
        <section className="relative isolate">
          <div className="hero-grid absolute inset-0 -z-10 opacity-70" aria-hidden="true" />
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8 lg:py-28">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex min-h-10 items-center rounded-full border border-emerald-200 bg-emerald-50 px-4">
                <StatusDot label="Nền tảng phát triển đã sẵn sàng" />
              </div>
              <h1 className="text-balance text-4xl font-extrabold tracking-tight text-ink sm:text-5xl lg:text-6xl">
                Vận hành logistics rõ ràng từ đầu đến cuối.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
                Một nền tảng thống nhất cho khách hàng, điều phối viên, tài xế và nhân viên kho —
                được xây dựng quanh dữ liệu đáng tin cậy.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  className="focus-ring inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-6 font-bold text-on-accent shadow-sm transition-colors hover:bg-accent-strong active:bg-accent-strong"
                  href="#foundation"
                >
                  Xem nền tảng kỹ thuật
                </a>
                {API_DOCS_URL ? (
                  <a
                    className="focus-ring inline-flex min-h-12 items-center justify-center rounded-xl border border-border-strong bg-card px-6 font-bold text-primary transition-colors hover:bg-primary-soft active:bg-primary-soft"
                    href={API_DOCS_URL}
                  >
                    Khám phá Swagger
                  </a>
                ) : null}
              </div>
            </div>

            <div
              aria-label="Mô hình luồng vận chuyển"
              className="relative rounded-3xl border border-border bg-card p-5 shadow-xl shadow-primary/10 sm:p-8"
              role="img"
            >
              <div className="flex items-center justify-between border-b border-border pb-5">
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">Luồng vận hành</p>
                  <p className="mt-1 text-xl font-bold text-ink">Shipment lifecycle</p>
                </div>
                <span className="rounded-full bg-primary-soft px-3 py-1.5 text-xs font-bold text-primary">
                  Foundation
                </span>
              </div>
              <ol className="mt-6 space-y-1">
                {['Tạo vận đơn', 'Lấy hàng', 'Qua kho', 'Giao hàng'].map((step, index) => (
                  <li className="group flex items-center gap-4" key={step}>
                    <div className="flex flex-col items-center self-stretch">
                      <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-extrabold text-on-primary">
                        {index + 1}
                      </span>
                      {index < 3 ? (
                        <span className="my-1 min-h-6 w-px flex-1 bg-border-strong" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1 rounded-xl border border-transparent px-3 py-3 transition-colors group-hover:border-border group-hover:bg-background">
                      <p className="font-bold text-ink">{step}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Trạng thái, actor và lịch sử được lưu nhất quán
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-card py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-extrabold uppercase tracking-[0.14em] text-primary">
                Định hướng sản phẩm
              </p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                Thiết kế cho nghiệp vụ thật, không phải CRUD demo.
              </h2>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {capabilities.map((capability) => (
                <article
                  className="rounded-2xl border border-border bg-background p-6 transition-colors hover:border-border-strong"
                  key={capability.title}
                >
                  <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
                    <svg
                      aria-hidden="true"
                      className="size-6"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                      viewBox="0 0 24 24"
                    >
                      <CapabilityIcon name={capability.icon} />
                    </svg>
                  </span>
                  <h3 className="mt-5 text-lg font-bold text-ink">{capability.title}</h3>
                  <p className="mt-2 leading-7 text-muted-foreground">{capability.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-24" id="foundation">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
              <div>
                <p className="text-sm font-extrabold uppercase tracking-[0.14em] text-primary">
                  Phase 0
                </p>
                <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                  Nền móng có thể kiểm chứng.
                </h2>
                <p className="mt-4 leading-7 text-muted-foreground">
                  Mỗi lớp được tách rõ để các phase nghiệp vụ tiếp theo mở rộng mà không đưa policy
                  vào controller hoặc component.
                </p>
              </div>
              <dl className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                {foundationItems.map(([label, value], index) => (
                  <div
                    className={`grid gap-1 px-5 py-5 sm:grid-cols-2 sm:items-center sm:px-6 ${
                      index > 0 ? 'border-t border-border' : ''
                    }`}
                    key={label}
                  >
                    <dt className="font-semibold text-muted-foreground">{label}</dt>
                    <dd className="font-bold text-ink sm:text-right">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>Logistics Operations Platform</p>
          <p>Foundation · API v1 · Accessible by default</p>
        </div>
      </footer>
    </div>
  );
}
