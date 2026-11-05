"""Render local Kokoro narration with sentence timings; model weights stay outside git."""
import json, re
from pathlib import Path
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

root = Path(__file__).resolve().parents[1]
out = root / 'output/hackathon/audio'
out.mkdir(parents=True, exist_ok=True)
model = Kokoro(str(root/'tmp/voice-model/kokoro-fast.onnx'), str(root/'tmp/voice-model/voices.bin'))
# Some Kokoro exports name their float speed input `input_ids`/`speed`, while
# kokoro-onnx 0.4.7 assumes int32. Match the actual ONNX input schema.
session = model.sess
class TypedSession:
    def get_inputs(self): return session.get_inputs()
    def run(self, outputs, values):
        types = {'tensor(float)':np.float32,'tensor(int64)':np.int64,'tensor(int32)':np.int32}
        return session.run(outputs,{i.name:np.asarray(values[i.name],dtype=types[i.type]) for i in session.get_inputs()})
model.sess = TypedSession()
paragraphs = (root/'media/hackathon-film/narration.txt').read_text(encoding='utf-8').strip().split('\n\n')
clips, captions, chapters = [], [], []
cursor = 0.65
sr = 24000
clips.append(np.zeros(round(cursor*sr), dtype=np.float32))
for index, paragraph in enumerate(paragraphs):
    begin = cursor
    for sentence in re.split(r'(?<=[.!?])\s+', paragraph.strip()):
        spoken = sentence.replace('MUSD', 'M U S D').replace('Mezo', 'Mezzo').replace('x402', 'X four oh two').replace('HTTP 402', 'H T T P four oh two').replace('API', 'A P I').replace('RelayGuard', 'Relay Guard')
        samples, sr = model.create(spoken, voice='af_heart', speed=1.04, lang='en-us')
        duration = len(samples)/sr
        captions.append({'text':sentence,'start':round(cursor,3),'end':round(cursor+duration,3),'chapter':index})
        clips.extend([samples, np.zeros(round(.22*sr),dtype=np.float32)])
        cursor += duration+.22
        print(f'{index+1}: {cursor:.1f}s {sentence}', flush=True)
    clips.append(np.zeros(round(.35*sr), dtype=np.float32)); cursor += .35
    chapters.append({'index':index,'start':round(begin,3),'end':round(cursor,3)})
sf.write(out/'narration.wav', np.concatenate(clips), sr)
(out/'timings.json').write_text(json.dumps({'voice':'Kokoro af_heart','sampleRate':sr,'duration':cursor,'chapters':chapters,'captions':captions},indent=2),encoding='utf-8')
print(f'Finished {cursor:.2f}s')
