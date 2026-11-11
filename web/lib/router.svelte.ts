// ponytail: a few flat routes don't need a router library.
export const route = $state({ path: location.pathname });

function go(path: string, replace: boolean) {
	if (path === route.path) return;
	history[replace ? 'replaceState' : 'pushState'](null, '', path);
	route.path = path;
}

export const navigate = (path: string) => go(path, false);
export const redirect = (path: string) => go(path, true);

addEventListener('popstate', () => (route.path = location.pathname));
