import sharp from "sharp";
import { profileInput, changePasswordInput, deactivateInput } from "@ffb/contracts";
import {
  user,
  ledger,
  publicProfile,
  changePassword,
  deactivate,
  DomainError,
} from "@ffb/database";
import { input, json, requireUser, cookie, type Context } from "../http.ts";
export async function usersRoutes(ctx: Context, path: string) {
  if (!path.startsWith("/api/users/")) return null;
  const { sql, request } = ctx,
    method = request.method;
  if (path.startsWith("/api/users/me")) {
    const id = requireUser(ctx);
    if (path === "/api/users/me" && method === "GET") return json(await user(sql, id));
    if (path === "/api/users/me/ledger" && method === "GET") return json(await ledger(sql, id));
    if (path === "/api/users/me/profile" && method === "PATCH") {
      const v = await input(request, profileInput);
      await sql`UPDATE users SET username=${v.username},display_name=${v.displayName} WHERE id=${id} AND deactivated_at IS NULL`;
      return json(await user(sql, id));
    }
    if (path === "/api/users/me/password" && method === "POST") {
      const v = await input(request, changePasswordInput),
        token = await changePassword(sql, id, v.currentPassword, v.newPassword);
      return new Response(JSON.stringify({ changed: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": cookie(token, ctx.config.NODE_ENV === "production"),
        },
      });
    }
    if (path === "/api/users/me/deactivate" && method === "POST") {
      const v = await input(request, deactivateInput);
      await deactivate(sql, id, v.password);
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": cookie("", ctx.config.NODE_ENV === "production", 0) },
      });
    }
    if (path === "/api/users/me/avatar") {
      if (method === "DELETE") {
        await sql`UPDATE users SET avatar=NULL,avatar_type=NULL WHERE id=${id} AND deactivated_at IS NULL`;
        return json(await user(sql, id));
      }
      if (method === "POST") {
        let form: Awaited<ReturnType<Request["formData"]>>;
        try {
          form = await request.formData();
        } catch {
          throw new DomainError(400, "Invalid upload body");
        }
        const file = form.get("avatar");
        if (
          !(file instanceof File) ||
          file.size > 2 * 1024 * 1024 ||
          !["image/png", "image/jpeg", "image/webp"].includes(file.type)
        )
          throw new DomainError(400, "Upload a PNG, JPEG or WebP up to 2 MB");
        let bytes: Buffer;
        try {
          const source = sharp(await file.arrayBuffer(), {
              limitInputPixels: 16000000,
              animated: false,
              failOn: "warning",
            }),
            meta = await source.metadata();
          if (
            !["png", "jpeg", "webp"].includes(meta.format) ||
            !meta.width ||
            !meta.height ||
            meta.width > 4096 ||
            meta.height > 4096 ||
            (meta.pages ?? 1) > 1
          )
            throw new Error("Invalid image");
          bytes = await source
            .rotate()
            .resize(256, 256, { fit: "cover" })
            .webp({ quality: 85 })
            .toBuffer();
        } catch {
          throw new DomainError(400, "Image could not be decoded");
        }
        await sql`UPDATE users SET avatar=${bytes},avatar_type='image/webp' WHERE id=${id} AND deactivated_at IS NULL`;
        return json(await user(sql, id));
      }
    }
    return null;
  }
  const match = /^\/api\/users\/([a-z][a-z0-9_]{2,29})(\/avatar)?$/.exec(path);
  if (match && method === "GET") {
    if (match[2]) {
      const [u] =
        await sql`SELECT avatar FROM users WHERE username=${match[1]} AND deactivated_at IS NULL`;
      if (!u?.avatar) throw new DomainError(404, "Avatar not found");
      return new Response(u.avatar, {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public,max-age=60",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return json(await publicProfile(sql, match[1]!));
  }
  return null;
}
