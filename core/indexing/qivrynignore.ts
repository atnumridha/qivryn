import fs from "fs";
import { IDE } from "..";
import { getGlobalQivrynIgnorePath } from "../util/paths";
import { gitIgArrayFromFile } from "./ignore";

export const getGlobalQivrynIgArray = () => {
  const contents = fs.readFileSync(getGlobalQivrynIgnorePath(), "utf8");
  return gitIgArrayFromFile(contents);
};

export const getWorkspaceQivrynIgArray = async (ide: IDE) => {
  const dirs = await ide.getWorkspaceDirs();
  return await dirs.reduce(
    async (accPromise, dir) => {
      const acc = await accPromise;
      try {
        const contents = await ide.readFile(`${dir}/.qivrynignore`);
        return [...acc, ...gitIgArrayFromFile(contents)];
      } catch (err) {
        console.error(err);
        return acc;
      }
    },
    Promise.resolve([] as string[]),
  );
};
