import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/auth/errors";
import { parseQueryParams } from "../src/app/api/_lib/validation";
import { pageQueryShape, toPageRequest } from "../src/app/api/_lib/pageQuery";
import {
  buildPage,
  DEFAULT_PAGE_SIZE,
  iterateInBatches,
  MAX_PAGE_SIZE,
  resolvePaging,
} from "../src/lib/pagination";
import { z } from "zod";

describe("resolvePaging", () => {
  it("defaults to page 1 and the default page size", () => {
    expect(resolvePaging()).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    });
  });

  it("turns a page number into the right skip", () => {
    expect(resolvePaging({ page: 3, pageSize: 10 })).toMatchObject({
      page: 3,
      skip: 20,
      take: 10,
    });
  });

  it("clamps the page size to the maximum", () => {
    expect(resolvePaging({ pageSize: 100_000 }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(resolvePaging({ pageSize: MAX_PAGE_SIZE }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(resolvePaging({ pageSize: MAX_PAGE_SIZE + 1 }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("falls back to safe values for zero, negative, fractional and non-finite input", () => {
    expect(resolvePaging({ page: 0 }).page).toBe(1);
    expect(resolvePaging({ page: -4 }).page).toBe(1);
    expect(resolvePaging({ page: Number.NaN }).page).toBe(1);
    expect(resolvePaging({ pageSize: 0 }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePaging({ pageSize: -1 }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePaging({ pageSize: Number.POSITIVE_INFINITY }).pageSize).toBe(
      DEFAULT_PAGE_SIZE,
    );
    expect(resolvePaging({ page: 2.9, pageSize: 10.9 })).toMatchObject({
      page: 2,
      pageSize: 10,
      skip: 10,
    });
  });
});

describe("buildPage", () => {
  it("reports at least one page even when nothing matches", () => {
    const page = buildPage([], 0, resolvePaging());
    expect(page).toEqual({ items: [], page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, pageCount: 1, nextCursor: null });
  });

  it("offers a next cursor on every page but the last", () => {
    expect(buildPage([], 50, resolvePaging({ pageSize: 25 })).nextCursor).not.toBeNull();
    expect(buildPage([], 50, resolvePaging({ pageSize: 25, page: 2 })).nextCursor).toBeNull();
  });

  it("rounds the page count up at the boundary", () => {
    expect(buildPage([], 50, resolvePaging({ pageSize: 25 })).pageCount).toBe(2);
    expect(buildPage([], 51, resolvePaging({ pageSize: 25 })).pageCount).toBe(3);
    expect(buildPage([], 1, resolvePaging({ pageSize: 25 })).pageCount).toBe(1);
  });
});

describe("iterateInBatches", () => {
  const rows = Array.from({ length: 11 }, (_, i) => i);
  const fetcher = (calls: Array<[number, number]>) => async (skip: number, take: number) => {
    calls.push([skip, take]);
    return rows.slice(skip, skip + take);
  };

  it("yields every row across batches, in order", async () => {
    const calls: Array<[number, number]> = [];
    const seen: number[] = [];
    for await (const row of iterateInBatches(fetcher(calls), 4)) seen.push(row);
    expect(seen).toEqual(rows);
    expect(calls).toEqual([
      [0, 4],
      [4, 4],
      [8, 4],
    ]);
  });

  it("stops after one fetch when the first batch is not full", async () => {
    const calls: Array<[number, number]> = [];
    const seen: number[] = [];
    for await (const row of iterateInBatches(fetcher(calls), 50)) seen.push(row);
    expect(seen).toEqual(rows);
    expect(calls).toHaveLength(1);
  });

  it("makes one extra empty fetch when the row count is an exact multiple of the batch size", async () => {
    const calls: Array<[number, number]> = [];
    const seen: number[] = [];
    const exact = async (skip: number, take: number) => {
      calls.push([skip, take]);
      return rows.slice(0, 10).slice(skip, skip + take);
    };
    for await (const row of iterateInBatches(exact, 5)) seen.push(row);
    expect(seen).toHaveLength(10);
    expect(calls).toHaveLength(3);
  });

  it("yields nothing for an empty set", async () => {
    const seen: number[] = [];
    for await (const row of iterateInBatches(async () => [], 5)) seen.push(row);
    expect(seen).toEqual([]);
  });
});

describe("page query parameters", () => {
  const schema = z.object(pageQueryShape);
  const parse = (qs: string) => toPageRequest(parseQueryParams(new URLSearchParams(qs), schema));

  it("reads page and pageSize as numbers", () => {
    expect(parse("page=2&pageSize=10")).toEqual({ page: 2, pageSize: 10 });
  });

  it("leaves both undefined when absent", () => {
    expect(parse("")).toEqual({ page: undefined, pageSize: undefined });
  });

  it("rejects non-numeric values with a validation error", () => {
    expect(() => parse("page=abc")).toThrow(ValidationError);
    expect(() => parse("pageSize=-3")).toThrow(ValidationError);
    expect(() => parse("page=1.5")).toThrow(ValidationError);
  });
});
