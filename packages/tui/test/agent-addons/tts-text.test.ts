import { expect, test } from "bun:test"
import { toSpeechSegments } from "../../src/agent-addons/tts/text"

test("isolates a German quote inside English prose", () => {
  expect(toSpeechSegments('He said „grüße dich" to us').map((segment) => segment.language)).toEqual(["en", "de", "en"])
})

test("isolates a straight single-quoted German phrase", () => {
  expect(toSpeechSegments("He said 'grüße' to us").map((segment) => segment.language)).toEqual(["en", "de", "en"])
})

test("merges adjacent segments with the same language", () => {
  expect(toSpeechSegments('He said "hello" to us')).toEqual([{ text: "He said hello to us", language: "en" }])
})

test("drops German quote marks from speech", () => {
  expect(toSpeechSegments("A „B“ C")).toEqual([{ text: "A B C", language: "en" }])
})

test("keeps straight apostrophes in contractions", () => {
  expect(toSpeechSegments("don't stop")).toEqual([{ text: "don't stop", language: "en" }])
})

test("detects a German part without quotes", () => {
  expect(toSpeechSegments("Das ist gut")).toEqual([{ text: "Das ist gut", language: "de" }])
})
