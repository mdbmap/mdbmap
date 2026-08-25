const welcomeHeading = "Welcome to TanStack Start";
const editPrefix = "Edit ";
const editFilePath = "src/routes/index.tsx";
const editSuffix = " to get started.";

export function Home() {
	return (
		<div className="p-8">
			<h1 className="text-4xl font-bold">{welcomeHeading}</h1>
			<p className="mt-4 text-lg">
				{editPrefix}
				<code>{editFilePath}</code>
				{editSuffix}
			</p>
		</div>
	);
}
