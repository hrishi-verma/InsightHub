from setuptools import setup, find_packages

setup(
    name='insighthub-sdk',
    version='1.0.0',
    description='Python SDK for InsightHub',
    packages=find_packages(),
    install_requires=[
        'requests>=2.31.0',
    ],
)
