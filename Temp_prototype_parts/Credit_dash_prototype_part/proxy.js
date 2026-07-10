import { NextResponse } from "next/server";

function unauthorizedResponse() {
  return new NextResponse("Authentication required.", {
    headers: {
      "WWW-Authenticate": 'Basic realm="Credit dashboard admin"',
    },
    status: 401,
  });
}

function notFoundResponse() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

function parseBasicAuth(authorizationHeader) {
  if (!authorizationHeader?.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = atob(authorizationHeader.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex === -1) {
      return null;
    }

    return {
      password: decoded.slice(separatorIndex + 1),
      username: decoded.slice(0, separatorIndex),
    };
  } catch {
    return null;
  }
}

function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

export function proxy(request) {
  if (process.env.ENABLE_ADMIN_TOOLS !== "true") {
    return notFoundResponse();
  }

  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return notFoundResponse();
  }

  const credentials = parseBasicAuth(request.headers.get("authorization"));

  if (
    !credentials ||
    !constantTimeEqual(credentials.username, expectedUsername) ||
    !constantTimeEqual(credentials.password, expectedPassword)
  ) {
    return unauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
