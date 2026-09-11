import type { PropsWithChildren } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark } from '../../../components/logo-mark';

interface AuthLayoutProps extends PropsWithChildren {
  eyebrow: string;
  title: string;
  description: string;
}

export function AuthLayout({ children, description, eyebrow, title }: AuthLayoutProps) {
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[0.9fr_1.1fr]">
      <a className="skip-link" href="#auth-form">
        Đến biểu mẫu
      </a>
      <aside className="relative hidden overflow-hidden bg-primary p-10 text-on-primary lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="auth-grid absolute inset-0 opacity-20" aria-hidden="true" />
        <Link
          className="focus-ring relative inline-flex items-center gap-3 self-start rounded-xl text-lg font-extrabold"
          to="/"
        >
          <LogoMark className="size-11 text-accent" />
          Logistics Operations
        </Link>
        <div className="relative max-w-xl py-16">
          <p className="text-sm font-extrabold uppercase tracking-[0.16em] text-blue-100">
            Tài khoản an toàn
          </p>
          <p className="mt-5 text-4xl font-extrabold leading-tight tracking-tight xl:text-5xl">
            Một danh tính, trách nhiệm rõ ràng trên mọi chặng vận hành.
          </p>
          <ul className="mt-8 space-y-4 text-blue-50">
            {[
              'Phân quyền theo vai trò',
              'Phiên đăng nhập có thể thu hồi',
              'Mật khẩu không bao giờ được lưu trực tiếp',
            ].map((item) => (
              <li className="flex items-center gap-3" key={item}>
                <svg
                  aria-hidden="true"
                  className="size-5 shrink-0 text-orange-300"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-blue-100">Logistics Operations · Secure access</p>
      </aside>

      <main className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6 lg:px-12">
        <div className="w-full max-w-lg">
          <Link
            className="focus-ring mb-10 inline-flex items-center gap-3 rounded-xl font-extrabold text-ink lg:hidden"
            to="/"
          >
            <LogoMark className="size-10 text-primary" />
            Logistics Operations
          </Link>
          <section
            className="rounded-3xl border border-border bg-card p-6 shadow-xl shadow-primary/8 sm:p-9"
            id="auth-form"
          >
            <p className="text-sm font-extrabold uppercase tracking-[0.14em] text-primary">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 leading-7 text-muted-foreground">{description}</p>
            <div className="mt-8">{children}</div>
          </section>
        </div>
      </main>
    </div>
  );
}
