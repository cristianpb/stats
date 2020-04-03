venv:
	# install some software with a dev image here
	python3 -m venv venv
	venv/bin/pip install -U -r requirements.txt

data:
	mkdir -p data

up: venv data
	venv/bin/python3 analytics.py

clean:
	rm -Rf venv data
