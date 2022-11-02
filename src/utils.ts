import { HttpError } from "@kubernetes/client-node";
import pc from "picocolors";

const NO_COLOR=process.env.NO_COLOR;

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function logWatchError(url: string, e: unknown, errorCnt: number) {
  const pause = Math.min(errorCnt * 6, 60);
  if (pause < 60 || errorCnt % 5 === 0) {
    if (e instanceof HttpError) {
      console.log(`Watch ${url} failed and return: ${e.statusCode}: ${e.message}" retrys in ${pause} sec`);
      console.log(`Body:`, e.body);
    } else if (e instanceof Error) {
      console.log(`Watch ${url} failed and return: ${e.message}" retrys in ${pause} sec`);
    } else {
      console.log(`Watch ${url} failed retrys in ${pause} sec`, e);
    }
  }
  await delay(pause * 1000);
}


export function formatResource(namespace: string, name: string): string {
    return `${formatNameSpace(namespace)}.${formatName(name)}`
}

export function formatName(name: string): string {
  if (NO_COLOR)
    return name;
  else 
    return pc.green(name);
}

export function formatPrefix(name: string): string {
  if (NO_COLOR)
    return name;
  else 
    return pc.bold(pc.magenta(name));
}


export function formatNameSpace(namespace: string): string {
  if (NO_COLOR)
    return namespace;
  else 
    return pc.gray(namespace);
}

export function formatNumber(num: number): string {
  if (NO_COLOR)
    return num.toString();
  else 
    return pc.yellow(num);
}
