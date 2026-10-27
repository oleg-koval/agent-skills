"""The narrator: Kokoro-82M on this computer, every line of a short in one go.

  python tts.py <model.onnx> <voices.bin> <voice> <speed> < jobs.json

jobs.json is [[text, out.wav], ...]. Loads the model once, writes one WAV per line,
prints one line per file. Apache-2.0 model, no account, nothing leaves the machine.
"""
import json
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

model, voices, voice, speed = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
lang = {"a": "en-us", "b": "en-gb", "e": "es", "f": "fr-fr", "h": "hi", "i": "it", "j": "ja", "p": "pt-br", "z": "cmn"}.get(voice[0], "en-us")
k = Kokoro(model, voices)
for text, out in json.load(sys.stdin):
    samples, rate = k.create(text, voice=voice, speed=speed, lang=lang)
    sf.write(out, samples, rate)
    print(out, flush=True)
