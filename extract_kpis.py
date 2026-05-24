import os
import glob

md = '# KPI Implementations\n\n'
md += "This document contains all the current KPI implementations and an explanation of the `aggregate` function.\n\n"

md += "## The `aggregate` Function\n"
md += "The `aggregate` function is a mandatory method present in all Scheduled KPIs. When the Scheduler runs a job over a period of time (e.g., 24 hours with a 1-hour step), the KPI produces multiple individual results (one for each hour). Instead of just saving these individual points, the backend passes all of them to the `aggregate` function. This function then calculates overall summary statistics—like the mean, max, min, and variability—for that entire period.\n\n"
md += "This aggregated summary is saved to the database as a single document (`doc_type: \"summary\"`). This is extremely useful because the frontend dashboards can simply fetch this single summary document to display daily/weekly averages or highs/lows, without having to load thousands of individual data points and recalculate the statistics on the fly.\n\n"
md += "---\n\n"

files = glob.glob('kpis_module/src/domain/kpis/*.py')
for f in files:
    if '__init__' in f:
        continue
    md += f'## {os.path.basename(f)}\n'
    md += '```python\n'
    with open(f, 'r', encoding='utf-8') as file:
        md += file.read()
    md += '\n```\n\n'

# Get artifact dir path from env
artifact_dir = r"C:\Users\franc\.gemini\antigravity-ide\brain\acac28dd-80ee-4ce0-9b65-a6d7d143317a\artifacts"
with open(os.path.join(artifact_dir, 'kpi_implementations.md'), 'w', encoding='utf-8') as f:
    f.write(md)

print("Artifact written successfully.")
