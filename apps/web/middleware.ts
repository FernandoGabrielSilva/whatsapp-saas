import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Redireciona todas as rotas de API para o backend Express
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.rewrite(
      new URL(request.nextUrl.pathname, process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000')
    );
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
