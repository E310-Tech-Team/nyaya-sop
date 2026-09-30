import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

/**
 * The single-use token from an emailed link (?token=…), read once and then taken out of the
 * address bar: it doesn't stay in history or bookmarks, and requests the page makes afterwards
 * don't repeat it in their Referer (which a proxy's access log may record). Call it before the
 * page's own effects, so the address is clean before they send anything.
 */
export function useLinkToken(): string {
  const [params] = useSearchParams();
  const [token] = useState(() => params.get('token') ?? '');
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!params.has('token')) return;
    const rest = new URLSearchParams(params);
    rest.delete('token');
    const search = rest.toString();
    void navigate({ pathname, search: search ? `?${search}` : '', hash }, { replace: true });
    // Once, on arrival: the token is kept in state from here on.
  }, []);
  return token;
}
