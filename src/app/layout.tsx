import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '내 가계부 | 개인 자금 관리',
  description: '계좌, 선결제 할인, 임시 인출·보충을 관리하는 개인 가계부',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
