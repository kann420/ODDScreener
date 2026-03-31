import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(thisDir, "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      let targetPath = path.join(projectRoot, specifier.slice(2));
      if (!path.extname(targetPath)) {
        targetPath += ".js";
      }
      return nextResolve(pathToFileURL(targetPath).href, context);
    }

    return nextResolve(specifier, context);
  },
});
