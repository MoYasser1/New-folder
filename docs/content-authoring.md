# Content authoring

Courses move through `draft → review → published → archived`. Only users with `course.create`, `course.update`, or `lesson.publish` may mutate content.

Each course contains ordered modules and lessons. Lessons store a short summary, transcript, duration, points, completion threshold, and optional protected video URL. Quizzes are graded only on the server; correct answers are never included in student catalog payloads.

Publishing is audited. Production authoring should use preview-as-student and require all lesson media, captions, transcript, downloadable assets, and quiz explanations before review approval.
